/** Shared dark color palette for the app's screens. */
export const colors = {
  bg: '#1a202c',
  surface: '#2d3748',
  border: '#4a5568',
  text: '#f7fafc',
  muted: '#a0aec0',
  primary: '#4299e1',
  primaryText: '#ffffff',
  danger: '#e53e3e',
  accent: '#48bb78',
} as const;

/** Gradient stops for the shared animated background (warm dusk: indigo → plum → rose). */
export const gradient = {
  colors: ['#202247', '#3e2350', '#5e2a4e', '#26243f'] as const,
};
