// ============================================================================
// Zero-Cost Push-to-Talk Voice Hook (Browser Web Speech API + Preset Simulator)
// (SPEC §1.5, §3.3, §5.1)
// ============================================================================

import { useState, useRef, useCallback } from 'react';

export function usePushToTalk(onTranscript: (text: string) => void) {
  const [isRecording, setIsRecording] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<string>('READY (HOLD OR TAP PUSH-TO-TALK)');
  const recognitionRef = useRef<any>(null);

  const startRecording = useCallback(() => {
    setIsRecording(true);
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      try {
        const rec = new SpeechRecognition();
        rec.lang = 'en-US';
        rec.interimResults = false;
        rec.maxAlternatives = 1;
        rec.onstart = () => setVoiceStatus('LISTENING VIA WEB SPEECH AUDIO...');
        rec.onresult = (event: any) => {
          const text = event.results?.[0]?.[0]?.transcript;
          if (text) {
            onTranscript(text);
            setVoiceStatus(`CAPTURED VOICE: "${text}"`);
          }
        };
        rec.onerror = () => {
          setVoiceStatus('MIC FALLBACK -> USE VOICE PRESET OR TEXT');
          setIsRecording(false);
        };
        rec.onend = () => {
          setIsRecording(false);
        };
        recognitionRef.current = rec;
        rec.start();
        return;
      } catch {
        // Fallback below
      }
    }

    setVoiceStatus('SIMULATED MIC CAPTURE ACTIVE — RELEASE TO TRANSCRIBE');
  }, [onTranscript]);

  const stopRecording = useCallback(
    (fallbackSampleText?: string) => {
      setIsRecording(false);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
        return;
      }
      if (fallbackSampleText) {
        onTranscript(fallbackSampleText);
        setVoiceStatus(`TRANSCRIBED VOICE: "${fallbackSampleText}"`);
      } else {
        setVoiceStatus('READY');
      }
    },
    [onTranscript]
  );

  return {
    isRecording,
    voiceStatus,
    startRecording,
    stopRecording,
  };
}
