// ============================================================================
// Toggle Voice Hook (Click Once to Start Listening, Click Again to Finish)
// With WhatsApp-style start & stop indicator chimes
// ============================================================================

import { useState, useRef, useCallback } from 'react';
import { sfx } from '../utils/soundEffects';

export function usePushToTalk(onTranscript: (text: string) => void) {
  const [isRecording, setIsRecording] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<string>('TAP SPEAK TO START');
  const recognitionRef = useRef<any>(null);
  const capturedTranscriptRef = useRef<string>('');

  const startRecording = useCallback(() => {
    sfx.playVoiceStart();
    setIsRecording(true);
    capturedTranscriptRef.current = '';

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      try {
        const rec = new SpeechRecognition();
        rec.lang = 'en-US';
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        rec.onstart = () => setVoiceStatus('LISTENING... TAP AGAIN TO SEND');
        rec.onresult = (event: any) => {
          let combined = '';
          for (let i = 0; i < event.results.length; i++) {
            combined += event.results[i][0].transcript;
          }
          if (combined.trim()) {
            capturedTranscriptRef.current = combined.trim();
            setVoiceStatus(`HEARD: "${combined.trim()}"`);
          }
        };
        rec.onerror = () => {
          // Keep toggle state active until user clicks again so fallback works smoothly
          setVoiceStatus('LISTENING... TAP AGAIN TO SEND');
        };
        recognitionRef.current = rec;
        rec.start();
        return;
      } catch {
        // Fallback below
      }
    }

    setVoiceStatus('LISTENING... TAP AGAIN TO SEND');
  }, []);

  const stopRecording = useCallback(
    (fallbackSampleText?: string) => {
      sfx.playVoiceStop();
      setIsRecording(false);

      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }

      const finalText = capturedTranscriptRef.current.trim() || fallbackSampleText?.trim() || '';
      capturedTranscriptRef.current = '';

      if (finalText) {
        onTranscript(finalText);
        setVoiceStatus(`SENT: "${finalText}"`);
      } else {
        setVoiceStatus('TAP SPEAK TO START');
      }
    },
    [onTranscript]
  );

  const toggleRecording = useCallback(
    (fallbackSampleText?: string) => {
      if (isRecording) {
        stopRecording(fallbackSampleText);
      } else {
        startRecording();
      }
    },
    [isRecording, startRecording, stopRecording]
  );

  return {
    isRecording,
    voiceStatus,
    startRecording,
    stopRecording,
    toggleRecording,
  };
}
