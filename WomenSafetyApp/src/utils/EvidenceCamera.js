import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Camera, useCameraDevice, useCameraPermission, useVideoOutput, CommonResolutions } from 'react-native-vision-camera';
import auth from '@react-native-firebase/auth';
import SecureVaultManager from './SecureVaultManager';

// Hidden background evidence recorder.
//
// While `active` (an SOS) this records video+audio to the owner-only evidence
// vault, INVISIBLY in the background (the SOS screen stays in front). Sequence:
//   1) FRONT camera for a short opener (~10s) — captures the user / who is with
//      them right away.
//   2) REAR camera CONTINUOUSLY for the rest of the emergency — this is the main
//      evidence (the scene / attacker). It records in long ~3-minute chunks so a
//      single file covers the whole incident for a typical SOS, while staying
//      under the 50 MB vault object cap; a crash never loses more than one chunk.
//
// The graceful stop (on SOS end) finalises the in-flight clip so the FULL
// recorded duration is saved — not a short fragment. Only one camera sensor runs
// at a time (works on every phone) and, because of that, every clip includes
// microphone audio. A full-size, non-zero-opacity surface is required or Android
// yields no frames; the class below keeps it mounted a few seconds after SOS ends
// so the finalise can complete.
const FRONT_CLIP_MS = 10000;   // brief front opener
const REAR_CHUNK_MS = 180000;  // 3-min continuous rear chunks (<50MB each)
const TAG = '[EvidenceCam]';

function EvidenceCameraInner({ active }) {
  const [pos, setPos] = React.useState('front');   // start on front, then stay on rear
  const [mounted, setMounted] = React.useState(false);
  const [sessionReady, setSessionReady] = React.useState(false);
  const device = useCameraDevice(pos);
  const { hasPermission, requestPermission } = useCameraPermission();
  const videoOutput = useVideoOutput({ enableAudio: true, targetResolution: CommonResolutions.HD_16_9, fileType: 'mp4' });
  const recorderRef = React.useRef(null);
  const busyRef = React.useRef(false);
  const frontDoneRef = React.useRef(false);
  const posRef = React.useRef(pos);
  const stopTimerRef = React.useRef(null);
  const activeRef = React.useRef(active);
  React.useEffect(() => { activeRef.current = active; }, [active]);
  React.useEffect(() => { posRef.current = pos; }, [pos]);

  React.useEffect(() => {
    if (active && !hasPermission) { try { requestPermission().catch(() => {}); } catch (e) {} }
  }, [active, hasPermission]);

  // Mount when active; on deactivation finalise the in-flight clip THEN unmount,
  // and reset for the next SOS (front opener again).
  React.useEffect(() => {
    let t = null;
    if (active) setMounted(true);
    else if (mounted) {
      (async () => { try { if (recorderRef.current) await recorderRef.current.stopRecording(); } catch (e) {} })();
      t = setTimeout(() => {
        setMounted(false); setSessionReady(false); setPos('front');
        frontDoneRef.current = false; busyRef.current = false;
      }, 3500);
    }
    return () => { if (t) clearTimeout(t); };
  }, [active, mounted]);

  React.useEffect(() => {
    if (!active || !mounted || !sessionReady || !device || !hasPermission) return;
    if (busyRef.current) return;
    let cancelled = false;
    busyRef.current = true;

    const uploadClip = (clipPos) => (res) => {
      try {
        const p = typeof res === 'string' ? res : (res && (res.filePath || res.path));
        const uid = auth().currentUser?.uid;
        if (uid && p) { SecureVaultManager.uploadEvidenceChunk(uid, String(p).replace('file://', ''), `video_${clipPos}`); console.log(`${TAG} SAVED ${clipPos} clip`); }
      } catch (e) {}
    };

    const afterClip = (clipPos) => {
      if (cancelled || !activeRef.current) { busyRef.current = false; return; }
      if (clipPos === 'front' && !frontDoneRef.current) {
        // Front opener done → switch to rear ONCE (session rebuild).
        frontDoneRef.current = true;
        busyRef.current = false;
        setSessionReady(false);
        setPos('back');
      } else {
        // Rear: keep recording continuously on the SAME session (no gap).
        setTimeout(() => recordChunk(), 250);
      }
    };

    const recordChunk = async () => {
      if (cancelled || !activeRef.current) { busyRef.current = false; return; }
      const clipPos = posRef.current;
      try {
        console.log(`${TAG} recording ${clipPos}…`);
        const r = await videoOutput.createRecorder({});
        if (cancelled || !activeRef.current) { try { await r.stopRecording(); } catch (e) {} busyRef.current = false; return; }
        recorderRef.current = r;
        await r.startRecording(uploadClip(clipPos), (e) => { console.log(`${TAG} rec error ${clipPos}: ${e && (e.message || e)}`); });
        stopTimerRef.current = setTimeout(async () => {
          try { await r.stopRecording(); } catch (e) {}
          if (recorderRef.current === r) recorderRef.current = null;
          afterClip(clipPos);
        }, clipPos === 'front' ? FRONT_CLIP_MS : REAR_CHUNK_MS);
      } catch (e) {
        console.log(`${TAG} clip ${clipPos} threw: ${e && (e.message || e)}`);
        recorderRef.current = null;
        if (clipPos === 'front' && !frontDoneRef.current) { frontDoneRef.current = true; busyRef.current = false; setSessionReady(false); setPos('back'); }
        else if (!cancelled && activeRef.current) setTimeout(() => recordChunk(), 1500);
        else busyRef.current = false;
      }
    };

    recordChunk();
    return () => { cancelled = true; if (stopTimerRef.current) { clearTimeout(stopTimerRef.current); stopTimerRef.current = null; } };
  }, [active, mounted, sessionReady, device, hasPermission, pos]);

  if (!mounted || !device || !hasPermission) return null;
  return (
    <View pointerEvents="none" style={styles.hidden}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        outputs={[videoOutput]}
        isActive={mounted}
        onStarted={() => { console.log(`${TAG} ${pos} STARTED`); setSessionReady(true); }}
        onStopped={() => setSessionReady(false)}
        onError={(e) => { console.log(`${TAG} ${pos} view error: ${e && (e.message || JSON.stringify(e))}`); }}
      />
    </View>
  );
}

// Error boundary + mount controller. Crucial: when `active` goes false we DO NOT
// unmount the recorder immediately — we keep it rendered a few seconds so the
// inner effect can run stopRecording() and FINALISE + upload the in-flight clip.
// Unmounting instantly (the old bug) tore the session down mid-record →
// ERROR_SOURCE_INACTIVE → nothing saved.
class EvidenceCamera extends React.Component {
  state = { failed: false, render: false };
  lingerTimer = null;
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e) { console.log(`${TAG} boundary caught: ${e && (e.message || e)}`); }
  sync() {
    if (this.props.active) {
      if (this.lingerTimer) { clearTimeout(this.lingerTimer); this.lingerTimer = null; }
      if (!this.state.render) this.setState({ render: true });
    } else if (this.state.render && !this.lingerTimer) {
      this.lingerTimer = setTimeout(() => { this.lingerTimer = null; this.setState({ render: false }); }, 5000);
    }
  }
  componentDidMount() { this.sync(); }
  componentDidUpdate() { this.sync(); }
  componentWillUnmount() { if (this.lingerTimer) clearTimeout(this.lingerTimer); }
  render() {
    if (this.state.failed || !this.state.render) return null;
    try { return <EvidenceCameraInner active={this.props.active} />; } catch (e) { console.log(`${TAG} render threw: ${e}`); return null; }
  }
}

const styles = StyleSheet.create({
  // Full-size, non-zero-opacity surface (needed for the camera to produce frames)
  // but painted at 0.02 opacity as the FIRST child so every opaque sibling — and
  // the SOS screen in front — covers it. The user never sees a preview.
  hidden: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.02 },
});

export default EvidenceCamera;
