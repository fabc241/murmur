import { Platform, useColorScheme } from 'react-native';

const light = {
  paper: '#F2F5F6',
  surface: '#FFFFFF',
  ink: '#13252B',
  muted: '#5B6F75',
  rule: '#D3DDE0',
  accent: '#2342A6',
  accentInk: '#FFFFFF',
  accentSoft: '#E3E8F7',
  record: '#C4372C',
  recordSoft: '#F7E1DE',
  caution: '#8A5A00',
  cautionSoft: '#FBF0D6',
  danger: '#B3261E',
};

const dark: typeof light = {
  paper: '#0E191C',
  surface: '#15242A',
  ink: '#E3ECEE',
  muted: '#8FA3A8',
  rule: '#24363C',
  accent: '#93A9FF',
  accentInk: '#0E191C',
  accentSoft: '#1E2C4F',
  record: '#FF6B5E',
  recordSoft: '#3A1F1D',
  caution: '#F2C46B',
  cautionSoft: '#33290F',
  danger: '#FF8A80',
};

export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

/** Iowan Old Style ships with iOS; the note reads like a chart document. */
export const SERIF = Platform.select({ ios: 'Iowan Old Style', default: 'serif' });

export const type = {
  display: { fontFamily: SERIF, fontSize: 30, lineHeight: 36, fontWeight: '600' as const },
  title: { fontFamily: SERIF, fontSize: 21, lineHeight: 27, fontWeight: '600' as const },
  heading: { fontFamily: SERIF, fontSize: 18, lineHeight: 24, fontWeight: '700' as const },
  document: { fontFamily: SERIF, fontSize: 17, lineHeight: 27 },
  body: { fontSize: 16, lineHeight: 23 },
  small: { fontSize: 14, lineHeight: 20 },
  caption: { fontSize: 13, lineHeight: 18 },
};

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };
