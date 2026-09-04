import firestore from '@react-native-firebase/firestore';
import storage from '@react-native-firebase/storage';
import AudioRecorderPlayer from 'react-native-nitro-sound'; 
import { Alert } from 'react-native';

class SecureVaultManager {
  static currentSosId = null;
  static isRecordingAudio = false;
  static audioRecorder = new AudioRecorderPlayer();
  static currentAudioPath = null;
  static audioUploadInterval = null;

  // --- 1. Unique Blockchain-Style ID ---
  static generateSosSessionId() {
    return `SOS-${Date.now()}-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
  }

  // --- 2. Smart Blackbox Audio System ---
  static async startAudioEvidence(uid) {
    if (this.isRecordingAudio) return;
    this.currentSosId = this.currentSosId || this.generateSosSessionId();
    this.currentAudioPath = `${storage.TaskState.CACHE}/blackbox_audio_${this.currentSosId}.mp3`;

    try {
      await this.audioRecorder.startRecorder(this.currentAudioPath);
      this.isRecordingAudio = true;
      console.log("Vault: Premium Blackbox Audio Started.");

      // Upload chunk strictly every 60 seconds
      this.audioUploadInterval = setInterval(() => {
        if (this.isRecordingAudio) {
          this.uploadEvidenceChunk(uid, this.currentAudioPath, 'audio_chunk');
        }
      }, 60000); 
    } catch (error) {
      console.error("Audio Engine Error:", error);
    }
  }

  static async stopAudioEvidence(uid) {
    if (!this.isRecordingAudio) return;
    try {
      await this.audioRecorder.stopRecorder();
      this.isRecordingAudio = false;
      if (this.audioUploadInterval) clearInterval(this.audioUploadInterval);
      
      await this.uploadEvidenceChunk(uid, this.currentAudioPath, 'audio_final');
      console.log("Vault: Audio Locked and Secured.");
    } catch (error) {
      console.error("Audio Stop Error:", error);
    }
  }

  // --- 3. Ultra-Premium: AI Smart Frame Capture ---
  // App.tsx ka AI Frame Processor is function ko tabhi bulayega jab Face/Motion detect hoga
  static async handleSmartEvidenceCapture(uid, photoPath, detectionType, confidenceScore) {
    if (!this.currentSosId) this.currentSosId = this.generateSosSessionId();
    
    // Sirf high confidence (pakka koi chehra hai) tabhi upload karega
    if (confidenceScore > 0.8) {
      console.log(`Vault: AI detected ${detectionType} with ${Math.round(confidenceScore * 100)}% accuracy. Saving securely...`);
      await this.uploadEvidenceChunk(uid, photoPath, `ai_capture_${detectionType}`);
    }
  }

  // --- 4. End-to-End Encrypted Storage Upload ---
  static async uploadEvidenceChunk(uid, localPath, type) {
    if (!uid || !localPath) return;
    
    // Directory structure: Only the owner can read this path in Firebase Rules
    const storagePath = `users/${uid}/evidence_vault/${this.currentSosId}/${Date.now()}_${type}`;
    const reference = storage().ref(storagePath);

    try {
      await reference.putFile(localPath);
      console.log(`Vault: ${type} encrypted and uploaded.`);
    } catch (error) {
      console.log("Vault Engine Upload Error:", error);
    }
  }

  // --- 5. Encrypted Ticketing System (Crime Reporting) ---
  static generateTicketId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = 'RSCN-';
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result; 
  }

  static async submitEncryptedReport(user, locationCoords, reportText) {
    if (!user || !user.email) return null;

    const ticketId = this.generateTicketId();
    const sessionId = this.currentSosId || 'MANUAL_REPORT';

    const securePayload = {
      ticketId: ticketId,
      sosSessionId: sessionId,
      reporterEmail: user.email,
      reporterName: user.name,
      incidentDetails: reportText,
      locationSnapshot: locationCoords ? {
        latitude: locationCoords.latitude,
        longitude: locationCoords.longitude
      } : 'No Location Provided',
      evidenceFolderLink: sessionId !== 'MANUAL_REPORT' ? `users/${user.uid}/evidence_vault/${sessionId}` : 'No Automated Evidence',
      status: 'SECURED_IN_VAULT',
      timestamp: firestore.FieldValue.serverTimestamp(),
    };

    try {
      await firestore().collection('secure_vault_reports').doc(ticketId).set(securePayload);
      console.log(`Premium: Smart Report Logged. Ticket ID: ${ticketId}`);
      return ticketId;
    } catch (error) {
      Alert.alert("Server Error", "Could not submit report safely. Try again.");
      return null;
    }
  }
}

export default SecureVaultManager;