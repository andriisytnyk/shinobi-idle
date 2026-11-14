/** Icon registry: each icon is a list of SVG path `d` strings drawn on a 24x24 grid. */
export const ICONS = {
  leaf: ['M5 19C5 10 10 5 20 4c0 10-5 15-14 15', 'M5 19 14 10'],
  flame: ['M12 3c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4-1-7 1-10Z'],
  wind: ['M3 8h11a3 3 0 1 0-3-3', 'M3 13h15a3 3 0 1 1-3 3', 'M3 18h7'],
  bolt: ['M13 2 5 14h6l-1 8 8-12h-6l1-8Z'],
  mountain: ['M2 20 9 7l4 7 3-5 6 11H2Z'],
  drop: ['M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11Z'],
  fist: [
    'M6 11V7a2 2 0 0 1 4 0v3',
    'M10 10V6a2 2 0 0 1 4 0v4',
    'M14 10V8a2 2 0 0 1 4 0v8a6 6 0 0 1-6 6h-1a5 5 0 0 1-5-5v-6',
  ],
  scroll: [
    'M6 4h12v14a2 2 0 0 0 2 2H8a2 2 0 0 1-2-2V4Z',
    'M6 4a2 2 0 0 0-2 2v2h2',
    'M10 9h6M10 13h6',
  ],
  coin: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 8v8M9.5 10.5h5M9.5 13.5h5'],
  star: ['m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z'],
  eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z'],
  shield: ['M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z'],
  menu: ['M4 6h16M4 12h16M4 18h16'],
  chevron: ['m9 6 6 6-6 6'],
  dots: ['M5 12h.01M12 12h.01M19 12h.01'],
  swords: ['m5 19 9-9', 'm14 4 6 0 0 6-9 9', 'm19 19-9-9', 'm10 4-6 0 0 6'],
  home: ['M4 11 12 4l8 7', 'M6 10v10h12V10'],
} as const satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof ICONS;

export const isIconName = (name: string): name is IconName => name in ICONS;
