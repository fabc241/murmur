import { AudioQuality, IOSOutputFormat, type RecordingOptions } from 'expo-audio';

/**
 * 16 kHz mono 16-bit little-endian Linear PCM in a WAV container: exactly the
 * input Parakeet expects, so no resampling or transcoding happens on device.
 * ~1.9 MB per minute.
 */
export const VISIT_RECORDING: RecordingOptions = {
  extension: '.wav',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 256000,
  isMeteringEnabled: true,
  ios: {
    extension: '.wav',
    outputFormat: IOSOutputFormat.LINEARPCM,
    audioQuality: AudioQuality.HIGH,
    sampleRate: 16000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  // iOS is the target platform; Android values only keep the type complete.
  android: {
    extension: '.m4a',
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
    sampleRate: 16000,
  },
  web: {},
};
