import functions from '@react-native-firebase/functions';
import { DeviceEventEmitter } from 'react-native';
import SafeJourneyEngine from './SafeJourneyEngine';

class RescuenBrain {
  
  static async processCommand(userMessage, contextData) {
    try {
      // Direct Firebase Gemini ko call lagayenge
      const askGeminiFunction = functions().httpsCallable('askGemini');
      const response = await askGeminiFunction({ 
        userMessage: userMessage, 
        contextData: contextData 
      });

      const data = response.data;

      if (data && data.success) {
        // 🔥 PURE AI FUNCTION CALLING LOGIC
        if (data.isFunctionCall) {
            console.log(`🤖 AI Decided to execute: ${data.functionName}`);
            
            if (data.functionName === 'activate_follow_me') {
                await SafeJourneyEngine.startTracking();
                return {
                    text: "🛡️ Understood! I have activated the 'Follow Me' mode. I am now strictly monitoring your live location and speed. Stay safe, I am awake.",
                    action: 'FOLLOW_ME_STARTED'
                };
            }
            else if (data.functionName === 'deactivate_follow_me') {
                await SafeJourneyEngine.stopTracking();
                return {
                    text: "✅ Follow Me mode deactivated. Glad you are safe!",
                    action: 'FOLLOW_ME_STOPPED'
                };
            }
            else if (data.functionName === 'trigger_sos') {
                DeviceEventEmitter.emit('TriggerRescueSOS', { source: 'AI_Chat' });
                return {
                    text: "🚨 EMERGENCY TRIGGERED! I have activated the SOS alarm, notified your family, and started the secure evidence vault. Help is on the way!",
                    action: 'SOS_TRIGGERED'
                };
            }
        } 
        // Normal Chat Logic
        else {
            return {
                text: data.text,
                action: 'NONE'
            };
        }
      } else {
        return {
          text: "I am facing a server delay. Please try again or use the manual buttons.",
          action: 'ERROR'
        };
      }
    } catch (error) {
      console.log("AI Brain Error:", error);
      return {
        text: "Network issue detected. Please use the main SOS button if you are in danger.",
        action: 'ERROR'
      };
    }
  }
}

export default RescuenBrain;