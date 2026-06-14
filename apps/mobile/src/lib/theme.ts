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

/** Gradient stops for the shared animated background (dark slate → indigo). */
export const gradient = {
  colors: ['#171e2e', '#1f2940', '#241f43', '#1a2030'] as const,
};
