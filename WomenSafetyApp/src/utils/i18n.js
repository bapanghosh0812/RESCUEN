// Lightweight i18n for RESCUEN. Add more keys/languages as needed.
// `tts` is the BCP-47 code passed to react-native-tts.
const STRINGS = {
  en: {
    name: 'English', tts: 'en-IN',
    areYouSafe: 'Are you safe?',
    autoSos: '{name}, I did not get your response, so I am activating S O S now.',
  },
  hi: {
    name: 'हिंदी', tts: 'hi-IN',
    areYouSafe: 'क्या आप सुरक्षित हैं?',
    autoSos: '{name}, आपका जवाब नहीं मिला, इसलिए मैं अभी एस ओ एस चालू कर रहा हूँ।',
  },
  bn: {
    name: 'বাংলা', tts: 'bn-IN',
    areYouSafe: 'আপনি কি নিরাপদ?',
    autoSos: '{name}, আপনার সাড়া পাইনি, তাই আমি এখন এস ও এস চালু করছি।',
  },
  mr: {
    name: 'मराठी', tts: 'mr-IN',
    areYouSafe: 'तुम्ही सुरक्षित आहात का?',
    autoSos: '{name}, तुमचा प्रतिसाद मिळाला नाही, म्हणून मी आता एस ओ एस सुरू करत आहे.',
  },
  ta: {
    name: 'தமிழ்', tts: 'ta-IN',
    areYouSafe: 'நீங்கள் பாதுகாப்பாக இருக்கிறீர்களா?',
    autoSos: '{name}, உங்கள் பதில் கிடைக்கவில்லை, எனவே நான் இப்போது எஸ் ஓ எஸ் ஐ இயக்குகிறேன்.',
  },
  te: {
    name: 'తెలుగు', tts: 'te-IN',
    areYouSafe: 'మీరు సురక్షితంగా ఉన్నారా?',
    autoSos: '{name}, మీ స్పందన అందలేదు, కాబట్టి నేను ఇప్పుడు ఎస్ ఓ ఎస్ ప్రారంభిస్తున్నాను.',
  },
};

export const getLang = (code) => STRINGS[code] || STRINGS.en;
export const t = (code, key, vars = {}) => {
  let s = (getLang(code)[key]) || STRINGS.en[key] || '';
  Object.keys(vars).forEach(k => { s = s.split('{' + k + '}').join(vars[k]); });
  return s;
};
export const LANGS = Object.keys(STRINGS).map(k => ({ code: k, name: STRINGS[k].name }));
export default STRINGS;
