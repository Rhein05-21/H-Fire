import { useAppTheme } from '@/context/ThemeContext';

export function useColorScheme() {
  const { colorScheme } = useAppTheme();
  return colorScheme;
}
