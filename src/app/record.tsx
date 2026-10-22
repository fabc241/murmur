import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { useKeepAwake } from 'expo-keep-awake';
import { Stack, router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VISIT_RECORDING } from '../audio/recordingOptions';
import { processVisit } from '../pipeline';
import { createVisitFromRecording } from '../storage/visits';
import { Button, Rule, formatDuration } from '../ui/components';
import { SERIF, space, type, useColors } from '../ui/theme';

const TRACE_BARS = 56;
type Phase = 'setup' | 'recording' | 'paused' | 'saving';

/** Maps iOS average power (dBFS, -160…0) to 0…1 with a speech-friendly floor. */
function level(db: number | undefined): number {
  if (db === undefined || !Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(1, (db + 55) / 50));
}

function LevelTrace({ levels, active }: { levels: number[]; active: boolean }) {
  const c = useColors();
  return (
    <View style={styles.trace} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.baseline, { backgroundColor: c.rule }]} />
      {levels.map((l, i) => (
        <View
          key={i}
          style={[
            styles.bar,
            {
              height: 2 + l * 92,
              backgroundColor: active ? c.record : c.muted,
              opacity: 0.25 + 0.75 * (i / levels.length),
            },
          ]}
        />
      ))}
    </View>
  );
}

export default function RecordScreen() {
  useKeepAwake();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const recorder = useAudioRecorder(VISIT_RECORDING);
  const state = useAudioRecorderState(recorder, 80);
  const [phase, setPhase] = useState<Phase>('setup');
  const [title, setTitle] = useState('');
  const [consent, setConsent] = useState(false);
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [levels, setLevels] = useState<number[]>(() => Array(TRACE_BARS).fill(0));
  const durationRef = useRef(0);

  useEffect(() => {
    requestRecordingPermissionsAsync().then((p) => setPermission(p.granted ? 'granted' : 'denied'));
    return () => {
      setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false }).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (phase !== 'recording') return;
    durationRef.current = state.durationMillis;
    setLevels((prev) => [...prev.slice(1), level(state.metering)]);
  }, [state.durationMillis, state.metering, phase]);

  const start = async () => {
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase('recording');
    } catch (e) {
      Alert.alert('Recording could not start', e instanceof Error ? e.message : String(e));
    }
  };

  const togglePause = () => {
    if (phase === 'recording') {
      recorder.pause();
      setPhase('paused');
    } else if (phase === 'paused') {
      recorder.record();
      setPhase('recording');
    }
  };

  const finish = async () => {
    setPhase('saving');
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error('The recording file is missing.');
      const visit = createVisitFromRecording(uri, {
        title,
        durationMs: Math.max(durationRef.current, state.durationMillis),
        consentConfirmed: consent,
      });
      processVisit(visit.id); // runs in the background; the visit screen shows progress
      router.replace({ pathname: '/visit/[id]', params: { id: visit.id } });
    } catch (e) {
      setPhase('paused');
      Alert.alert('The visit could not be saved', e instanceof Error ? e.message : String(e));
    }
  };

  const discard = () => {
    if (phase === 'setup') return router.back();
    Alert.alert('Discard this recording?', 'The audio will be deleted from this iPhone.', [
      { text: 'Keep recording', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: async () => {
          await recorder.stop().catch(() => undefined);
          if (recorder.uri) {
            const file = new File(recorder.uri);
            if (file.exists) file.delete();
          }
          router.back();
        },
      },
    ]);
  };

  const live = phase === 'recording' || phase === 'paused' || phase === 'saving';

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.paper }}>
      <Stack.Screen
        options={{
          title: live ? (title.trim() || 'Recording') : 'New visit',
          headerLeft: () => <Button variant="quiet" label={live ? 'Discard' : 'Cancel'} onPress={discard} />,
        }}
      />
      {!live ? (
        <View style={[styles.setup, { paddingBottom: insets.bottom + space.md }]}>
          <View style={styles.field}>
            <Text style={[type.small, { color: c.muted }]}>Visit name (optional)</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Follow-up, room 3"
              placeholderTextColor={c.muted}
              style={[type.title, styles.input, { color: c.ink, borderBottomColor: c.rule }]}
              returnKeyType="done"
              autoCorrect={false}
              accessibilityHint="Avoid full patient names; use initials or a room number."
            />
            <Text style={[type.caption, { color: c.muted }]}>Prefer initials or a room number to a full name.</Text>
          </View>

          <Rule />
          <Pressable style={styles.consent} onPress={() => setConsent((v) => !v)} accessibilityRole="switch" accessibilityState={{ checked: consent }}>
            <Text style={[type.body, { color: c.ink, flex: 1 }]}>The patient agreed to this visit being recorded</Text>
            <Switch value={consent} onValueChange={setConsent} trackColor={{ true: c.accent }} />
          </Pressable>
          <Rule />

          {permission === 'denied' && (
            <View style={styles.permission}>
              <Text style={[type.small, { color: c.danger }]}>
                Murmur needs microphone access to record visits. Turn it on in Settings.
              </Text>
              <Button variant="quiet" label="Open Settings" onPress={() => Linking.openSettings()} />
            </View>
          )}

          <View style={{ flex: 1 }} />
          <Button
            variant="record"
            label="Start recording"
            icon={<View style={styles.recDot} />}
            disabled={!consent || permission !== 'granted'}
            onPress={start}
          />
        </View>
      ) : (
        <View style={[styles.live, { paddingBottom: insets.bottom + space.md }]}>
          <View style={styles.statusRow} accessibilityLiveRegion="polite">
            <View style={[styles.liveDot, { backgroundColor: phase === 'recording' ? c.record : c.muted }]} />
            <Text style={[type.small, { color: phase === 'recording' ? c.record : c.muted, fontWeight: '600' }]}>
              {phase === 'recording' ? 'Recording' : phase === 'paused' ? 'Paused' : 'Saving'}
            </Text>
          </View>

          <Text
            style={[styles.timer, { color: c.ink }]}
            accessibilityLabel={`Elapsed ${formatDuration(state.durationMillis)}`}
          >
            {formatDuration(state.durationMillis)}
          </Text>

          <LevelTrace levels={levels} active={phase === 'recording'} />

          <Text style={[type.small, styles.hint, { color: c.muted }]}>
            You can lock the screen; recording continues. Place the iPhone between you and the patient.
          </Text>

          <View style={{ flex: 1 }} />
          <View style={styles.controls}>
            <Button
              variant="secondary"
              label={phase === 'paused' ? 'Resume' : 'Pause'}
              onPress={togglePause}
              disabled={phase === 'saving'}
              style={{ flex: 1 }}
            />
            <Button
              label="Finish visit"
              onPress={finish}
              busy={phase === 'saving'}
              disabled={state.durationMillis < 1000}
              style={{ flex: 1.4 }}
              accessibilityHint="Stops recording and starts transcription"
            />
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  setup: { flex: 1, padding: space.lg, gap: space.lg },
  field: { gap: space.sm },
  input: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: space.sm },
  consent: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 },
  permission: { gap: space.xs, alignItems: 'flex-start' },
  live: { flex: 1, paddingHorizontal: space.lg, paddingTop: space.xl, gap: space.lg },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  liveDot: { width: 10, height: 10, borderRadius: 5 },
  timer: { fontFamily: SERIF, fontSize: 76, lineHeight: 84, fontWeight: '500', fontVariant: ['tabular-nums'], letterSpacing: -1 },
  trace: { height: 100, flexDirection: 'row', alignItems: 'center', gap: 2 },
  baseline: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, top: 50 },
  bar: { flex: 1, borderRadius: 1.5 },
  hint: { maxWidth: 420 },
  controls: { flexDirection: 'row', gap: space.md },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFFFFF' },
});
