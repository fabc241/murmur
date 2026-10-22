import { Paths } from 'expo-file-system';
import { useKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { MODELS, formatBytes, markModelsReady, prepareModel, type ModelKey } from '../qvac/models';
import { Button, ProgressBar, Rule } from '../ui/components';
import { space, type, useColors } from '../ui/theme';

type RowState = { status: 'waiting' | 'working' | 'done' | 'failed'; pct: number };

const ORDER: ModelKey[] = ['asr', 'llm'];
const TOTAL_BYTES = MODELS.asr.approxBytes + MODELS.llm.approxBytes;
// Parakeet's Core ML encoder and temporary files need headroom beyond the GGUF sizes.
const REQUIRED_BYTES = TOTAL_BYTES + 1.5e9;

export default function SetupScreen() {
  useKeepAwake();
  const c = useColors();
  const [rows, setRows] = useState<Record<ModelKey, RowState>>({
    asr: { status: 'waiting', pct: 0 },
    llm: { status: 'waiting', pct: 0 },
  });
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  let freeBytes: number | null = null;
  try {
    freeBytes = Paths.availableDiskSpace;
  } catch {
    freeBytes = null;
  }
  const lowSpace = freeBytes !== null && freeBytes < REQUIRED_BYTES;

  const update = (key: ModelKey, next: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [key]: { ...prev[key], ...next } }));

  const start = async () => {
    setRunning(true);
    setError(null);
    let current: ModelKey | null = null;
    try {
      for (const key of ORDER) {
        if (rows[key].status === 'done') continue;
        current = key;
        update(key, { status: 'working' });
        await prepareModel(key, (pct) => update(key, { pct }));
        update(key, { status: 'done', pct: 100 });
      }
      markModelsReady();
      router.replace('/');
    } catch (e) {
      if (current) update(current, { status: 'failed' });
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content} style={{ backgroundColor: c.paper }}>
      <Text style={[type.display, { color: c.ink }]}>Everything stays on this iPhone</Text>
      <Text style={[type.body, styles.lede, { color: c.muted }]}>
        Murmur transcribes visits and drafts notes with two AI models that run on the device. Download them once
        (about {formatBytes(TOTAL_BYTES)}); after that, recording, transcription and notes work offline and no audio
        or text is sent anywhere.
      </Text>

      <View style={[styles.list, { borderColor: c.rule }]}>
        {ORDER.map((key, i) => {
          const m = MODELS[key];
          const row = rows[key];
          return (
            <View key={key}>
              {i > 0 && <Rule />}
              <View style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={[type.body, { color: c.ink, fontWeight: '600' }]}>{m.label}</Text>
                  <Text style={[type.caption, { color: c.muted }]}>
                    {m.detail}, {formatBytes(m.approxBytes)}
                  </Text>
                </View>
                <Text style={[type.small, { color: row.status === 'failed' ? c.danger : c.muted, fontVariant: ['tabular-nums'] }]}>
                  {row.status === 'done' ? 'Ready' : row.status === 'failed' ? 'Failed' : row.status === 'working' ? `${Math.round(row.pct)}%` : 'Waiting'}
                </Text>
              </View>
              {row.status === 'working' && <ProgressBar value={row.pct} />}
            </View>
          );
        })}
      </View>

      {lowSpace && (
        <Text style={[type.small, { color: c.danger }]}>
          This iPhone has {formatBytes(freeBytes ?? 0)} free. Murmur needs about {formatBytes(REQUIRED_BYTES)}. Free up
          space before downloading.
        </Text>
      )}
      {error && (
        <Text style={[type.small, { color: c.danger }]}>
          The download stopped: {error}. Check your connection and try again; finished parts are kept.
        </Text>
      )}

      <Button
        label={running ? 'Downloading…' : error ? 'Try again' : 'Download models'}
        onPress={start}
        busy={running}
        disabled={lowSpace}
      />
      <Text style={[type.caption, { color: c.muted }]}>
        Use Wi-Fi and keep Murmur open until both models are ready. Loading each model once also checks it runs on
        this iPhone.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 },
  lede: { marginTop: -space.sm },
  list: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.md, gap: space.md },
  rowText: { flex: 1, gap: 2 },
});
