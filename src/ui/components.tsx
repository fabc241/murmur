import { type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { space, type, useColors } from './theme';

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger' | 'record';
  disabled?: boolean;
  busy?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
};

export function Button({ label, onPress, variant = 'primary', disabled, busy, icon, style, accessibilityHint }: ButtonProps) {
  const c = useColors();
  const palette = {
    primary: { bg: c.accent, fg: c.accentInk, border: c.accent },
    record: { bg: c.record, fg: '#FFFFFF', border: c.record },
    secondary: { bg: 'transparent', fg: c.ink, border: c.rule },
    quiet: { bg: 'transparent', fg: c.accent, border: 'transparent' },
    danger: { bg: 'transparent', fg: c.danger, border: 'transparent' },
  }[variant];
  const inactive = disabled || busy;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!busy }}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        variant === 'quiet' || variant === 'danger' ? styles.buttonQuiet : null,
        { backgroundColor: palette.bg, borderColor: palette.border, opacity: inactive ? 0.45 : pressed ? 0.75 : 1 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={palette.fg} /> : icon}
      <Text style={[type.body, styles.buttonLabel, { color: palette.fg }]}>{label}</Text>
    </Pressable>
  );
}

export function ProgressBar({ value, color }: { value: number; color?: string }) {
  const c = useColors();
  const pct = Math.max(0, Math.min(100, value));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}
      style={[styles.track, { backgroundColor: c.rule }]}
    >
      <View style={[styles.fill, { width: `${pct}%`, backgroundColor: color ?? c.accent }]} />
    </View>
  );
}

/** The standing reminder of what Murmur does and does not do. */
export function ScopeNotice({ compact }: { compact?: boolean }) {
  const c = useColors();
  return (
    <View style={[styles.notice, { backgroundColor: c.cautionSoft }]}>
      <Text style={[compact ? type.caption : type.small, { color: c.caution }]}>
        Documentation aid only. Murmur records what was said in the visit; it does not diagnose or recommend
        treatment. Review every note before using it.
      </Text>
    </View>
  );
}

export function Rule({ style }: { style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: c.rule }, style]} />;
}

export function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatMinutes(ms: number): string {
  const min = Math.round(ms / 60000);
  return min < 1 ? 'under 1 min' : `${min} min`;
}

export function formatVisitDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today at ${time}`;
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday at ${time}`;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })} at ${time}`;
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  buttonQuiet: { minHeight: 44, paddingHorizontal: space.sm },
  buttonLabel: { fontWeight: '600' },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
  notice: { borderRadius: 10, paddingHorizontal: space.md, paddingVertical: space.sm + 2 },
});
