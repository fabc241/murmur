import * as Clipboard from 'expo-clipboard';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SECTION_TITLES, SOAP_SECTIONS, noteToPlainText, type SoapNote } from '../../note/schema';
import { cancelProcessing, processVisit, regenerateNote, useVisitJob, type PipelineProgress } from '../../pipeline';
import { audioFile, deleteVisit, getVisit, subscribeVisits, updateVisit, type Visit } from '../../storage/visits';
import { Button, ProgressBar, Rule, ScopeNotice, formatDuration, formatMinutes, formatVisitDate } from '../../ui/components';
import { space, type, useColors } from '../../ui/theme';

function useVisit(id: string) {
  const [visit, setVisit] = useState<Visit | null | undefined>(undefined);
  const refresh = useCallback(() => {
    getVisit(id).then(setVisit);
  }, [id]);
  useEffect(() => {
    refresh();
    return subscribeVisits(refresh);
  }, [refresh]);
  return visit;
}

// --- Processing --------------------------------------------------------------------

const STEPS = ['Transcribe', 'Write note', 'Review'] as const;

function stepIndex(progress: PipelineProgress | undefined, visit: Visit): number {
  if (progress?.stage === 'note' || visit.status === 'generating') return 1;
  if (visit.status === 'ready') return 2;
  return 0;
}

function Steps({ active }: { active: number }) {
  const c = useColors();
  return (
    <View style={styles.steps} accessibilityRole="progressbar" accessibilityLabel={`Step ${active + 1} of 3: ${STEPS[active]}`}>
      {STEPS.map((s, i) => (
        <View key={s} style={styles.step}>
          <View style={[styles.stepBar, { backgroundColor: i <= active ? c.accent : c.rule }]} />
          <Text style={[type.caption, { color: i === active ? c.ink : c.muted, fontWeight: i === active ? '600' : '400' }]}>
            {i + 1}. {s}
          </Text>
        </View>
      ))}
    </View>
  );
}

function ProcessingView({ visit, progress }: { visit: Visit; progress: PipelineProgress | undefined }) {
  const c = useColors();
  const [showReasoning, setShowReasoning] = useState(false);

  let headline = 'Waiting for the previous visit to finish…';
  let pct: number | null = null;
  if (progress?.stage === 'transcription') {
    if (progress.phase === 'loading') {
      headline = 'Loading speech recognition…';
      pct = progress.pct;
    } else {
      headline = `Transcribing minute ${Math.min(progress.done + 1, progress.total)} of ${progress.total}`;
      pct = (progress.done / progress.total) * 100;
    }
  } else if (progress?.stage === 'note') {
    if (progress.phase === 'loading') {
      headline = 'Loading the note model…';
      pct = progress.pct;
    } else {
      headline = progress.content ? `${progress.pass}…` : 'Reading the transcript…';
    }
  }
  const streaming = progress?.stage === 'note' && progress.phase === 'generating' ? progress : null;

  return (
    <View style={styles.processing}>
      <Steps active={stepIndex(progress, visit)} />
      <Text style={[type.body, { color: c.ink }]} accessibilityLiveRegion="polite">
        {headline}
      </Text>
      {pct !== null && <ProgressBar value={pct} />}
      <Text style={[type.caption, { color: c.muted }]}>
        Keep Murmur open. Processing runs on this iPhone and pauses if you switch apps.
      </Text>

      {streaming?.content ? (
        <Text style={[type.document, { color: c.muted }]}>{streaming.content}</Text>
      ) : null}
      {streaming?.thinking ? (
        <View style={{ gap: space.sm }}>
          <Button variant="quiet" label={showReasoning ? 'Hide model reasoning' : 'Show model reasoning'} onPress={() => setShowReasoning((v) => !v)} style={{ alignSelf: 'flex-start' }} />
          {showReasoning && <Text style={[type.caption, { color: c.muted }]}>{streaming.thinking}</Text>}
        </View>
      ) : null}

      <Button variant="secondary" label="Stop processing" onPress={() => cancelProcessing(visit.id)} />
    </View>
  );
}

// --- Note ---------------------------------------------------------------------------

function NoteView({ visit }: { visit: Visit }) {
  const c = useColors();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SoapNote | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const note = visit.note!;
  const removed = visit.removedStatements ?? [];

  const save = async () => {
    if (draft) await updateVisit(visit.id, { note: draft, noteEdited: true });
    setEditing(false);
  };

  return (
    <View style={{ gap: space.lg }}>
      {SOAP_SECTIONS.map((s) => (
        <View key={s} style={[styles.section, { borderLeftColor: c.accent }]}>
          <Text style={[type.heading, { color: c.ink }]} accessibilityRole="header">
            {SECTION_TITLES[s]}
          </Text>
          {editing ? (
            <TextInput
              multiline
              scrollEnabled={false}
              value={draft?.[s] ?? note[s]}
              onChangeText={(t) => setDraft((d) => ({ ...(d ?? note), [s]: t }))}
              style={[type.document, styles.editor, { color: c.ink, backgroundColor: c.surface, borderColor: c.rule }]}
              accessibilityLabel={`${SECTION_TITLES[s]} section`}
            />
          ) : (
            <Text selectable style={[type.document, { color: c.ink }]}>
              {note[s]}
            </Text>
          )}
        </View>
      ))}

      <View style={styles.inlineActions}>
        {editing ? (
          <>
            <Button label="Save note" onPress={save} style={{ flex: 1 }} />
            <Button variant="secondary" label="Cancel" onPress={() => { setDraft(null); setEditing(false); }} style={{ flex: 1 }} />
          </>
        ) : (
          <Button variant="secondary" label="Edit note" onPress={() => { setDraft(note); setEditing(true); }} style={{ flex: 1 }} />
        )}
      </View>

      {visit.noteEdited && <Text style={[type.caption, { color: c.muted }]}>Edited by you after it was generated.</Text>}

      {removed.length > 0 && (
        <View style={[styles.removed, { backgroundColor: c.cautionSoft }]}>
          <Pressable onPress={() => setShowRemoved((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: showRemoved }}>
            <Text style={[type.small, { color: c.caution, fontWeight: '600' }]}>
              Murmur removed {removed.length} {removed.length === 1 ? 'statement' : 'statements'} that the model wrote but
              nobody said in the visit. {showRemoved ? 'Hide' : 'Show'}
            </Text>
          </Pressable>
          {showRemoved &&
            removed.map((r, i) => (
              <Text key={i} style={[type.caption, { color: c.caution }]}>
                {r.text} ({r.section}: {r.reason})
              </Text>
            ))}
        </View>
      )}

      {visit.thinking ? (
        <View style={{ gap: space.sm }}>
          <Button
            variant="quiet"
            label={showReasoning ? 'Hide model reasoning' : 'Show model reasoning'}
            onPress={() => setShowReasoning((v) => !v)}
            style={{ alignSelf: 'flex-start' }}
          />
          {showReasoning && (
            <Text selectable style={[type.caption, { color: c.muted }]}>
              {visit.thinking}
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

// --- Transcript ---------------------------------------------------------------------

function TranscriptView({ visit }: { visit: Visit }) {
  const c = useColors();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(visit.transcript ?? '');

  const save = async () => {
    await updateVisit(visit.id, { transcript: draft, transcriptEdited: true });
    setEditing(false);
  };

  const regenerate = () => {
    const run = () => regenerateNote(visit.id);
    if (visit.noteEdited) {
      Alert.alert('Write a new note?', 'Your edits to the current note will be replaced.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Write new note', style: 'destructive', onPress: run },
      ]);
    } else run();
  };

  return (
    <View style={{ gap: space.lg }}>
      {editing ? (
        <TextInput
          multiline
          scrollEnabled={false}
          value={draft}
          onChangeText={setDraft}
          style={[type.body, styles.editor, { color: c.ink, backgroundColor: c.surface, borderColor: c.rule }]}
          accessibilityLabel="Transcript"
        />
      ) : (
        <Text selectable style={[type.body, { color: c.ink }]}>
          {visit.transcript || 'No speech was detected.'}
        </Text>
      )}
      <View style={styles.inlineActions}>
        {editing ? (
          <>
            <Button label="Save transcript" onPress={save} style={{ flex: 1 }} />
            <Button variant="secondary" label="Cancel" onPress={() => { setDraft(visit.transcript ?? ''); setEditing(false); }} style={{ flex: 1 }} />
          </>
        ) : (
          <>
            <Button variant="secondary" label="Correct transcript" onPress={() => { setDraft(visit.transcript ?? ''); setEditing(true); }} style={{ flex: 1 }} />
            <Button variant="secondary" label="Write new note" onPress={regenerate} style={{ flex: 1 }} />
          </>
        )}
      </View>
      <Text style={[type.caption, { color: c.muted }]}>
        Transcripts have no speaker labels. Correct names, drugs and doses here, then write a new note.
      </Text>
    </View>
  );
}

// --- Screen -------------------------------------------------------------------------

function AudioControl({ id, durationMs }: { id: string; durationMs: number }) {
  const c = useColors();
  const player = useAudioPlayer(audioFile(id).uri);
  const status = useAudioPlayerStatus(player);
  const toggle = () => {
    if (status.playing) player.pause();
    else {
      if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration - 0.2)) player.seekTo(0);
      player.play();
    }
  };
  return (
    <Pressable onPress={toggle} accessibilityRole="button" style={styles.audio} hitSlop={8}>
      <Text style={[type.small, { color: c.accent, fontWeight: '600' }]}>{status.playing ? 'Pause audio' : 'Play audio'}</Text>
      <Text style={[type.small, { color: c.muted, fontVariant: ['tabular-nums'] }]}>
        {formatDuration(status.currentTime * 1000)} / {formatDuration(durationMs)}
      </Text>
    </Pressable>
  );
}

export default function VisitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const visit = useVisit(id);
  const job = useVisitJob(id);
  const [tab, setTab] = useState<'note' | 'transcript'>('note');

  if (visit === undefined) return null;
  if (visit === null) {
    return (
      <View style={[styles.body, { backgroundColor: c.paper }]}>
        <Text style={[type.body, { color: c.muted }]}>This visit no longer exists.</Text>
      </View>
    );
  }

  const processing = !!job;
  const hasNote = !!visit.note && !processing;
  const plainText = () =>
    noteToPlainText(visit.note!, `${visit.title}\n${formatVisitDate(visit.createdAt)}\nDraft generated by Murmur; reviewed by the treating clinician.`);

  const remove = () =>
    Alert.alert('Delete this visit?', 'The recording, transcript and note will be permanently deleted from this iPhone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (processing) await cancelProcessing(visit.id);
          deleteVisit(visit.id);
          router.back();
        },
      },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <Stack.Screen options={{ title: '' }} />
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space.xl }]} keyboardDismissMode="interactive">
        <View style={{ gap: space.xs }}>
          <Text style={[type.display, { color: c.ink }]}>{visit.title}</Text>
          <Text style={[type.small, { color: c.muted }]}>
            {formatVisitDate(visit.createdAt)}, {formatMinutes(visit.durationMs)}
            {visit.consentConfirmed ? ', recording consent confirmed' : ''}
          </Text>
        </View>
        <AudioControl id={visit.id} durationMs={visit.durationMs} />
        <ScopeNotice compact />

        {processing ? (
          <ProcessingView visit={visit} progress={job.progress} />
        ) : visit.status === 'error' || visit.status === 'recorded' || visit.status === 'transcribed' ? (
          <View style={styles.processing}>
            <Steps active={visit.transcript === undefined ? 0 : 1} />
            {visit.error && <Text style={[type.body, { color: c.danger }]}>{visit.error}</Text>}
            <Button
              label={visit.status === 'error' ? 'Retry' : 'Process visit'}
              onPress={() => (visit.transcript === undefined ? processVisit(visit.id) : regenerateNote(visit.id))}
            />
            {visit.transcript !== undefined && (
              <Button variant="quiet" label="View transcript" onPress={() => setTab('transcript')} />
            )}
          </View>
        ) : null}

        {(hasNote || (!processing && visit.transcript !== undefined && tab === 'transcript')) && (
          <>
            <View style={[styles.segment, { backgroundColor: c.rule }]} accessibilityRole="tablist">
              {(['note', 'transcript'] as const).map((t) => (
                <Pressable
                  key={t}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === t }}
                  onPress={() => setTab(t)}
                  style={[styles.segmentItem, tab === t && { backgroundColor: c.surface }]}
                >
                  <Text style={[type.small, { color: c.ink, fontWeight: tab === t ? '600' : '400' }]}>
                    {t === 'note' ? 'SOAP note' : 'Transcript'}
                  </Text>
                </Pressable>
              ))}
            </View>
            {tab === 'note' && visit.note ? <NoteView key={visit.noteGeneratedAt} visit={visit} /> : <TranscriptView visit={visit} />}
          </>
        )}

        {hasNote && tab === 'note' && (
          <>
            <Rule />
            <View style={styles.inlineActions}>
              <Button
                variant="secondary"
                label="Copy note"
                onPress={async () => {
                  await Clipboard.setStringAsync(plainText());
                  Alert.alert('Note copied', 'Paste it into the patient record after reviewing it.');
                }}
                style={{ flex: 1 }}
              />
              <Button variant="secondary" label="Share note" onPress={() => Share.share({ message: plainText() })} style={{ flex: 1 }} />
            </View>
          </>
        )}
        <Button variant="danger" label="Delete visit" onPress={remove} style={{ alignSelf: 'flex-start' }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.lg },
  audio: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 },
  processing: { gap: space.md },
  steps: { flexDirection: 'row', gap: space.sm },
  step: { flex: 1, gap: space.xs },
  stepBar: { height: 3, borderRadius: 1.5 },
  segment: { flexDirection: 'row', borderRadius: 10, padding: 2 },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: space.sm, borderRadius: 8, minHeight: 36, justifyContent: 'center' },
  section: { borderLeftWidth: 2, paddingLeft: space.md, gap: space.xs },
  editor: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, padding: space.sm, minHeight: 60 },
  inlineActions: { flexDirection: 'row', gap: space.md },
  removed: { borderRadius: 10, padding: space.md, gap: space.sm },
});
