/**
 * CloudHub Platform — Light Theme
 *
 * Design principles:
 *  • Sidebar:    Deep-purple background (#6B21A8) with white text/icons
 *  • Primary:    #6B21A8 (rich purple, matched from portal nav gradient)
 *  • Secondary:  #9333EA (lighter purple accent)
 *  • Background: Clean off-white (#F8F9FA) / paper white (#FFFFFF)
 *  • Typography: Inter → Roboto fallback, standardised heading/body scale
 *  • Page headers: purple-to-violet gradient (mirrors the header screenshots)
 *  • Components: uniform border-radius, consistent card/table styling
 */

import {
  createUnifiedTheme,
  genPageTheme,
  palettes,
  shapes,
} from '@backstage/theme';

// ── Brand colours ──────────────────────────────────────────────────────────────
// Matching project_glance / Cloud FinOps: blue-900 sidebar, blue-700 active
const CloudHub_PURPLE = '#1e3a8a'; // primary — sidebar & headers (blue-900)
const CloudHub_PURPLE_DARK = '#1e40af'; // hover / pressed state (blue-800)
const CloudHub_PURPLE_LIGHT = '#2563eb'; // secondary accent (blue-600)
const CloudHub_PURPLE_INDICATOR = '#93c5fd'; // active sidebar item indicator (blue-300)

// ── Page-header gradient ───────────────────────────────────────────────────────
const CloudHub_PAGE_GRADIENT = ['#1e3a8a', '#1d4ed8', '#2563eb'];

// ── Page themes (blue gradient header banners) ─────────────────────────────────
const purplePageTheme = genPageTheme({
  colors: CloudHub_PAGE_GRADIENT,
  shape: shapes.wave,
  options: { fontColor: '#FFFFFF' },
});

const subtlePageTheme = genPageTheme({
  colors: ['#1e3a8a', '#1e40af'],
  shape: shapes.wave2,
  options: { fontColor: '#FFFFFF' },
});

export const cloudhubLightTheme = createUnifiedTheme({
  // ── Palette ─────────────────────────────────────────────────────────────────
  palette: {
    ...palettes.light,
    mode: 'light',

    // ── Core MUI colours ────────────────────────────────────────────────────
    primary: {
      main: CloudHub_PURPLE,
      dark: CloudHub_PURPLE_DARK,
      light: '#A855F7',
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: CloudHub_PURPLE_LIGHT,
      dark: CloudHub_PURPLE,
      light: '#C084FC',
      contrastText: '#FFFFFF',
    },
    error: {
      main: '#DC2626',
      dark: '#B91C1C',
      light: '#FCA5A5',
    },
    warning: {
      main: '#D97706',
      dark: '#B45309',
      light: '#FCD34D',
    },
    info: {
      main: '#0284C7',
      dark: '#0369A1',
      light: '#7DD3FC',
    },
    success: {
      main: '#16A34A',
      dark: '#15803D',
      light: '#86EFAC',
    },

    // ── Surfaces ─────────────────────────────────────────────────────────────
    background: {
      default: '#F8F9FA',
      paper: '#FFFFFF',
    },
    text: {
      primary: '#111827',
      secondary: '#6B7280',
      disabled: '#9CA3AF',
    },
    divider: '#E5E7EB',

    // ── Backstage-specific additions ─────────────────────────────────────────
    // Left-nav sidebar colours
    navigation: {
      background: CloudHub_PURPLE,
      indicator: CloudHub_PURPLE_INDICATOR,
      color: '#ffffff', // unselected item text/icon
      selectedColor: '#ffffff', // selected item text/icon
      navItem: {
        hoverBackground: 'rgba(255, 255, 255, 0.14)',
      },
      submenu: {
        background: CloudHub_PURPLE_DARK,
      },
    },

    // Pin-sidebar button
    pinSidebarButton: {
      icon: '#ffffff',
      background: CloudHub_PURPLE_DARK,
    },

    // Informational banners
    banner: {
      info: '#0284C7',
      error: '#DC2626',
      text: '#FFFFFF',
      link: '#BFDBFE',
      warning: '#D97706',
      closeButtonColor: '#FFFFFF',
    },

    // Status chips / badges
    status: {
      ok: '#16A34A',
      warning: '#D97706',
      error: '#DC2626',
      running: '#0284C7',
      pending: '#1d4ed8',
      aborted: '#6B7280',
    },

    // Misc contextual colours
    border: '#E5E7EB',
    textContrast: '#FFFFFF',
    textVerySubtle: '#D1D5DB',
    textSubtle: '#9CA3AF',
    highlight: '#eff6ff', // subtle blue tint for highlights
    errorBackground: '#FEF2F2',
    warningBackground: '#FFFBEB',
    infoBackground: '#EFF6FF',
    errorText: '#991B1B',
    infoText: '#1E40AF',
    warningText: '#92400E',
    linkHover: CloudHub_PURPLE_DARK,
    link: CloudHub_PURPLE,
    gold: '#D97706',

    tabbar: {
      indicator: CloudHub_PURPLE,
    },

    // Bursts (legacy colorful sections — kept minimal)
    bursts: {
      fontColor: '#FFFFFF',
      slackChannelText: '#dbeafe',
      backgroundColor: { default: CloudHub_PURPLE },
      gradient: {
        linear: `linear-gradient(90deg, ${CloudHub_PURPLE} 0%, ${CloudHub_PURPLE_LIGHT} 100%)`,
      },
    },

    code: {
      background: '#F3F4F6',
    },
  },

  // ── Typography ──────────────────────────────────────────────────────────────
  // System font stack — Inter first (if loaded), falls back to Roboto
  fontFamily: '"Inter", "Roboto", "Helvetica Neue", Arial, sans-serif',
  htmlFontSize: 16,

  typography: {
    htmlFontSize: 16,
    fontFamily: '"Inter", "Roboto", "Helvetica Neue", Arial, sans-serif',
    // Base sizes target ~1440px; scale down slightly at 1280px, up at 1920px
    h1: { fontSize: '2rem', fontWeight: 700, marginBottom: 20 },
    h2: { fontSize: '1.5rem', fontWeight: 700, marginBottom: 16 },
    h3: { fontSize: '1.25rem', fontWeight: 600, marginBottom: 12 },
    h4: { fontSize: '1.125rem', fontWeight: 600, marginBottom: 10 },
    h5: { fontSize: '1rem', fontWeight: 600, marginBottom: 8 },
    h6: { fontSize: '0.875rem', fontWeight: 600, marginBottom: 6 },
  },

  // ── Page header themes ───────────────────────────────────────────────────────
  defaultPageTheme: 'home',
  pageTheme: {
    home: purplePageTheme,
    documentation: subtlePageTheme,
    tool: purplePageTheme,
    service: purplePageTheme,
    website: purplePageTheme,
    library: subtlePageTheme,
    other: purplePageTheme,
    app: purplePageTheme,
    apis: subtlePageTheme,
  },

  // ── MUI component overrides ─────────────────────────────────────────────────
  components: {
    // ── Buttons ──────────────────────────────────────────────────────────────
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          textTransform: 'none',
          fontWeight: 600,
          letterSpacing: '0.01em',
          fontSize: '0.875rem',
        },
        containedPrimary: {
          backgroundColor: CloudHub_PURPLE,
          '&:hover': { backgroundColor: CloudHub_PURPLE_DARK },
        },
        outlinedPrimary: {
          borderColor: CloudHub_PURPLE,
          color: CloudHub_PURPLE,
          '&:hover': {
            borderColor: CloudHub_PURPLE_DARK,
            backgroundColor: '#eff6ff',
          },
        },
        textPrimary: {
          color: CloudHub_PURPLE,
          '&:hover': { backgroundColor: '#eff6ff' },
        },
      },
    },

    // ── Cards ─────────────────────────────────────────────────────────────────
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
          border: '1px solid #F3F4F6',
        },
      },
    },

    MuiCardHeader: {
      styleOverrides: {
        root: {
          paddingBottom: 8,
        },
        title: {
          fontSize: '1rem',
          fontWeight: 600,
          color: '#111827',
        },
        subheader: {
          fontSize: '0.8125rem',
          color: '#6B7280',
        },
      },
    },

    // ── Paper / surfaces ──────────────────────────────────────────────────────
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
        elevation1: {
          boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
        },
        elevation2: {
          boxShadow: '0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.05)',
        },
      },
    },

    // ── Tables ────────────────────────────────────────────────────────────────
    MuiTableHead: {
      styleOverrides: {
        root: {
          backgroundColor: '#F9FAFB',
        },
      },
    },

    MuiTableCell: {
      styleOverrides: {
        head: {
          fontWeight: 600,
          fontSize: '0.8125rem',
          color: '#374151',
          borderBottom: '2px solid #E5E7EB',
          backgroundColor: '#F9FAFB',
          letterSpacing: '0.02em',
          textTransform: 'none',
        },
        body: {
          fontSize: '0.875rem',
          color: '#111827',
          borderBottom: '1px solid #F3F4F6',
        },
      },
    },

    MuiTableRow: {
      styleOverrides: {
        root: {
          '&:hover': { backgroundColor: '#F5F3FF' },
          '&:last-child td': { borderBottom: 0 },
        },
      },
    },

    // ── Chips / badges ────────────────────────────────────────────────────────
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          fontWeight: 500,
          fontSize: '0.75rem',
        },
        colorPrimary: {
          backgroundColor: '#F5F3FF',
          color: CloudHub_PURPLE,
          border: `1px solid #DDD6FE`,
        },
        outlinedPrimary: {
          borderColor: CloudHub_PURPLE,
          color: CloudHub_PURPLE,
        },
      },
    },

    // ── Text fields / inputs ──────────────────────────────────────────────────
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          fontSize: '0.875rem',
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: CloudHub_PURPLE,
            borderWidth: 2,
          },
        },
      },
    },

    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontSize: '0.875rem',
          '&.Mui-focused': { color: CloudHub_PURPLE },
        },
      },
    },

    // ── Tabs ──────────────────────────────────────────────────────────────────
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          fontSize: '0.875rem',
          minWidth: 0,
          padding: '8px 16px',
        },
      },
    },

    MuiTabs: {
      styleOverrides: {
        indicator: {
          backgroundColor: CloudHub_PURPLE,
          height: 3,
          borderRadius: '3px 3px 0 0',
        },
      },
    },

    // ── Links / list items ────────────────────────────────────────────────────
    MuiListItem: {
      styleOverrides: {
        root: {
          borderRadius: 4,
        },
      },
    },

    // ── Sidebar nav item text ─────────────────────────────────────────────────
    MuiListItemText: {
      styleOverrides: {
        primary: {
          fontSize: '0.9375rem',
          fontWeight: 400,
          letterSpacing: '0.01em',
        },
      },
    },

    // ── Dialog ────────────────────────────────────────────────────────────────
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 12,
          boxShadow: '0 20px 40px rgba(0,0,0,0.12)',
        },
      },
    },

    MuiDialogTitle: {
      styleOverrides: {
        root: {
          fontSize: '1.125rem',
          fontWeight: 700,
          padding: '20px 24px 12px',
        },
      },
    },

    // ── Tooltips ──────────────────────────────────────────────────────────────
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          fontSize: '0.75rem',
          backgroundColor: '#1F2937',
          borderRadius: 4,
        },
      },
    },

    // ── Stepper (used in scaffolder forms) ───────────────────────────────────
    MuiStepper: {
      styleOverrides: {
        root: {
          padding: '16px 8px',
          background: 'transparent',
        },
        horizontal: {
          alignItems: 'flex-start',
        },
      },
    },

    MuiStep: {
      styleOverrides: {
        root: {
          padding: '0 8px',
        },
      },
    },

    MuiStepConnector: {
      styleOverrides: {
        root: {
          top: 12,
          '&.Mui-active': {
            '& .MuiStepConnector-line': { borderColor: CloudHub_PURPLE },
          },
          '&.Mui-completed': {
            '& .MuiStepConnector-line': { borderColor: '#16A34A' },
          },
        },
        line: {
          borderTopWidth: 2,
          minWidth: 24,
          borderColor: '#DDD6FE',
        },
      },
    },

    MuiStepIcon: {
      styleOverrides: {
        root: {
          color: '#D1D5DB',
          fontSize: '1.5rem',
          transition: 'transform 0.2s ease, color 0.2s ease',
          '&.Mui-active': {
            color: CloudHub_PURPLE,
            transform: 'scale(1.15)',
          },
          '&.Mui-completed': { color: '#16A34A' },
        },
      },
    },

    MuiStepLabel: {
      styleOverrides: {
        label: {
          fontSize: '0.8125rem',
          fontWeight: 500,
          '&.Mui-active': { fontWeight: 700, color: CloudHub_PURPLE },
          '&.Mui-completed': { fontWeight: 600, color: '#374151' },
        },
        iconContainer: {
          paddingRight: 6,
        },
      },
    },

    // ── Form controls — constrain width for readability ───────────────────────
    MuiFormControl: {
      styleOverrides: {
        root: {
          // Scaffolder form inputs should not stretch to unlimited width
          '@media (min-width: 1024px)': {
            maxWidth: 560,
          },
          '@media (min-width: 1600px)': {
            maxWidth: 640,
          },
        },
      },
    },

    MuiFormHelperText: {
      styleOverrides: {
        root: {
          fontSize: '0.75rem',
          lineHeight: 1.4,
          marginTop: 4,
        },
      },
    },

    // ── Breadcrumbs ───────────────────────────────────────────────────────────
    MuiBreadcrumbs: {
      styleOverrides: {
        root: { fontSize: '0.8125rem' },
      },
    },

    // ── AppBar (used by Backstage page headers when not using page themes) ────
    MuiAppBar: {
      styleOverrides: {
        root: {
          borderBottom: 'none !important',
          borderTop: 'none !important',
        },
        colorDefault: {
          backgroundColor: '#FFFFFF',
          color: '#111827',
          borderBottom: 'none !important',
          border: 'none !important',
          boxShadow: 'none',
        },
      },
    },

    // ── Top toolbar / header area ──────────────────────────────────────────────
    MuiToolbar: {
      styleOverrides: {
        root: {
          borderBottom: 'none !important',
          borderTop: 'none !important',
        },
      },
    },

    // ── Typography global defaults ────────────────────────────────────────────
    MuiTypography: {
      styleOverrides: {
        body1: { fontSize: '0.875rem', lineHeight: 1.6 },
        body2: { fontSize: '0.8125rem', lineHeight: 1.5, color: '#6B7280' },
        caption: { fontSize: '0.75rem', color: '#9CA3AF' },
        overline: {
          fontSize: '0.6875rem',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: '#9CA3AF',
        },
      },
    },

    // ── Dividers ──────────────────────────────────────────────────────────────
    MuiDivider: {
      styleOverrides: {
        root: { borderColor: '#E5E7EB' },
      },
    },

    // ── Badges ────────────────────────────────────────────────────────────────
    MuiBadge: {
      styleOverrides: {
        colorPrimary: {
          backgroundColor: CloudHub_PURPLE,
          color: '#FFFFFF',
        },
      },
    },

    // ── Sidebar Drawer ────────────────────────────────────────────────────────
    // Set an explicit text colour on the drawer paper so that child elements
    // which use `color: inherit` resolve to white navigation colour.
    // The `& a` rule is intentionally broad within the drawer (sidebar links)
    // but does NOT affect page-level <nav> elements which are outside the Drawer.
    MuiDrawer: {
      styleOverrides: {
        paper: {
          color: '#ffffff',
          '& [class*="selected"] a, & [class*="selected"] span, & [aria-current]':
            {
              color: '#ffffff !important',
            },
          '& nav a': {
            color: 'inherit !important',
          },
        },
      },
    },

    // ── Global CSS baseline ───────────────────────────────────────────────────
    // Sidebar navigation fix: scope all nav colour overrides to the MUI Drawer
    // paper so they don't bleed into page-level <nav> elements (e.g. MUI Tabs,
    // breadcrumbs, etc.).
    MuiCssBaseline: {
      styleOverrides: {
        // Only target <nav> links that live inside the sidebar Drawer paper
        '.MuiDrawer-paper nav a': {
          color: '#ffffff !important',
          textDecoration: 'none',
        },
        '.MuiDrawer-paper nav a *': {
          color: '#ffffff !important',
        },
        '.MuiDrawer-paper nav a[aria-current="page"]': {
          color: '#ffffff !important',
        },
        '.MuiDrawer-paper nav a[aria-current="page"] *': {
          color: '#ffffff !important',
        },
        '.MuiDrawer-paper nav [aria-current="page"]': {
          color: '#ffffff !important',
        },
        '.MuiDrawer-paper nav [aria-current="page"] *': {
          color: '#ffffff !important',
        },
        '.MuiDrawer-paper nav [class*="selected"]': {
          color: '#ffffff !important',
        },
        '.MuiDrawer-paper nav [class*="selected"] *': {
          color: '#ffffff !important',
        },
      },
    },
  },
});
