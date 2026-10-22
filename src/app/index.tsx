import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVisitJob } from '../pipeline';
import { areModelsReady } from '../qvac/models';
import { listVisits, subscribeVisits, type Visit } from '../storage/visits';
import { Button, Rule, formatMinutes, formatVisitDate } from '../ui/components';
import { space, type, useColors } from '../ui/theme';

function useVisits() {
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const refresh = useCallback(() => {
    listVisits().then(setVisits).catch(() => setVisits([]));
  }, []);
  useEffect(() => subscribeVisits(refresh), [refresh]);
  useFocusEffect(refresh);
  return visits;
}

function statusLabel(v: Visit): { text: string; tone: 'muted' | 'accent' | 'danger' } | null {
  switch (v.status) {
    case 'ready':
      return v.noteEdited ? { text: 'Note edited', tone: 'muted' } : null;
    case 'recorded':
    case 'transcribed':
      return { text: 'Waiting to process', tone: 'muted' };
    case 'transcribing':
      return { text: 'Transcribing…', tone: 'accent' };
    case 'generating':
      return { text: 'Writing note…', tone: 'accent' };
    case 'error':
      return { text: 'Needs attention', tone: 'danger' };
  }
}

function VisitRow({ visit }: { visit: Visit }) {
  const c = useColors();
  useVisitJob(visit.id); // re-render while this visit is processing
  const status = statusLabel(visit);
  const toneColor = status && { muted: c.muted, accent: c.accent, danger: c.danger }[status.tone];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${visit.title}, ${formatVisitDate(visit.createdAt)}${status ? `, ${status.text}` : ''}`}
      onPress={() => router.push({ pathname: '/visit/[id]', params: { id: visit.id } })}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Text style={[type.title, { color: c.ink }]} numberOfLines={1}>
        {visit.title}
      </Text>
      <View style={styles.meta}>
        <Text style={[type.small, { color: c.muted }]}>
          {formatVisitDate(visit.createdAt)}, {formatMinutes(visit.durationMs)}
        </Text>
        {status && <Text style={[type.small, { color: toneColor!, fontWeight: '600' }]}>{status.text}</Text>}
      </View>
    </Pressable>
  );
}

export default function VisitsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [ready, setReady] = useState<boolean | null>(null);
  const visits = useVisits();

  useEffect(() => {
    areModelsReady().then(setReady).catch(() => setReady(false));
  }, []);

  if (ready === false) return <Redirect href="/setup" />;
  if (ready === null || visits === null) {
    return (
      <View style={[styles.center, { backgroundColor: c.paper }]}>
        <ActivityIndicator color={c.muted} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        data={visits}
        keyExtractor={(v) => v.id}
        renderItem={({ item }) => <VisitRow visit={item} />}
        ItemSeparatorComponent={() => <Rule style={{ marginLeft: space.lg }} />}
        contentContainerStyle={{ paddingBottom: 120 + insets.bottom, flexGrow: 1 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[type.title, { color: c.ink }]}>No visits yet</Text>
            <Text style={[type.body, { color: c.muted }]}>
              Record a visit and Murmur will transcribe it and draft a SOAP note for you to review. Recordings,
              transcripts and notes stay on this iPhone.
            </Text>
          </View>
        }
      />
      <View style={[styles.footer, { paddingBottom: insets.bottom + space.sm, backgroundColor: c.paper, borderTopColor: c.rule }]}>
        <Button
          variant="record"
          label="Record a visit"
          icon={<View style={styles.recDot} />}
          onPress={() => router.push('/record')}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.xs },
  meta: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  empty: { paddingHorizontal: space.lg, paddingTop: space.xl, gap: space.sm, maxWidth: 520 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFFFFF' },
});
