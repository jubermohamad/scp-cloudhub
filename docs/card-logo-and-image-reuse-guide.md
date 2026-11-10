# Card Logos and Image Reuse Guide

This guide documents the logos, icons, and other visual assets used by CloudHub cards. It is intended for implementing the same visual language in another React project.

## Executive Summary

CloudHub cards do **not** download bitmap images from a CDN. The current implementation uses:

1. **Material UI icons** from `@mui/icons-material`.
2. **One CloudHub inline SVG mark** stored in the source code.
3. **One Microsoft inline SVG mark** for the sign-in button.
4. **Text branding and CSS gradients/colors** for the remaining visual treatment.

That means a separate project can reproduce the cards without copying an image folder or adding an image download step. Install the same icon package, copy the relevant icon mapping and style tokens, and copy the inline SVG only when the actual logo mark is required.

## Source Of Truth Files

| Visual surface               | Source file                                                                                                                         | What to copy                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| CloudHub sidebar mark        | [`packages/app/src/modules/nav/LogoIcon.tsx`](../packages/app/src/modules/nav/LogoIcon.tsx)                                         | The inline SVG `viewBox`, path, dark fill, and white logo tile   |
| Full sidebar wordmark        | [`packages/app/src/modules/nav/LogoFull.tsx`](../packages/app/src/modules/nav/LogoFull.tsx)                                         | Text label and typography styles                                 |
| Sidebar responsive logo      | [`packages/app/src/modules/nav/SidebarLogo.tsx`](../packages/app/src/modules/nav/SidebarLogo.tsx)                                   | Open/closed state selection between wordmark and mark            |
| Microsoft sign-in mark       | [`packages/app/src/components/CloudHubSignInPage.tsx`](../packages/app/src/components/CloudHubSignInPage.tsx)                       | The `MicrosoftLogo` inline SVG component                         |
| Dashboard and workflow cards | [`plugins/platform-home/src/components/PlatformHomePage.tsx`](../plugins/platform-home/src/components/PlatformHomePage.tsx)         | Card data, icon imports, colors, gradients, and rendering styles |
| SRI application cards        | [`plugins/platform-home/src/components/SriDeployPage.tsx`](../plugins/platform-home/src/components/SriDeployPage.tsx)               | `DEPLOY_CARDS` data and deploy-card styles                       |
| SRI component cards          | [`plugins/platform-home/src/components/SriDeploymentHubPage.tsx`](../plugins/platform-home/src/components/SriDeploymentHubPage.tsx) | `SRI_CARD_META` icon/accent mapping                              |
| SRI service cards            | [`plugins/platform-home/src/components/SriPage.tsx`](../plugins/platform-home/src/components/SriPage.tsx)                           | `SRI_CARD_ICONS` mapping and fallback icon                       |
| Template category cards      | [`packages/app/src/components/TemplatesCatalogPage.tsx`](../packages/app/src/components/TemplatesCatalogPage.tsx)                   | Category icon/color/gradient data and card header layout         |

Generated `dist` files are not sources of truth and should not be copied.

## Asset Inventory

### 1. Material UI Icons

These are React components, not downloaded image files. They are imported from the installed npm package and rendered as SVG by Material UI.

#### Dashboard and quick-link cards

Defined in [`PlatformHomePage.tsx`](../plugins/platform-home/src/components/PlatformHomePage.tsx):

| Card or service                 | Icon component     | Accent    |
| ------------------------------- | ------------------ | --------- |
| GPU Compute                     | `MemoryIcon`       | `#0F766E` |
| Infrastructure / Create Test VM | `StorageIcon`      | `#EA580C` |
| Deployment                      | `CloudUploadIcon`  | `#2563EB` |
| Customer Onboarding             | `PersonAddIcon`    | `#7C3AED` |
| Platform Registry               | `FolderSharedIcon` | `#C2410C` |
| Azure                           | `CloudQueueIcon`   | `#0078D4` |
| Observability                   | `TimelineIcon`     | `#2563EB` |
| Diagnostics                     | `NetworkCheckIcon` | `#9333EA` |
| Deployment service              | `BuildIcon`        | `#0891B2` |
| Cost Management                 | `BarChartIcon`     | `#EA580C` |
| Onboard Customer                | `PersonAddIcon`    | `#7C3AED` |
| Create Kubernetes Cluster       | `CloudQueueIcon`   | `#0891B2` |
| Deploy Common-res               | `LayersIcon`       | `#0D9488` |
| Deploy SRI                      | `StorageIcon`      | `#2563EB` |
| Deploy NetReveal                | `CloudUploadIcon`  | `#EA580C` |
| Deploy Customer Overlay         | `PeopleIcon`       | `#059669` |
| SRI Provisioner                 | `BuildIcon`        | `#111827` |

The SRI Provisioner card opens `https://sri-provisioner.invhub.fseng.net/` in a
new tab with `noopener,noreferrer`.

The same page also uses `LockIcon` for secure workflows and `CheckCircleIcon` for status treatments.

#### SRI application cards

The `DEPLOY_CARDS` array in [`SriDeployPage.tsx`](../plugins/platform-home/src/components/SriDeployPage.tsx) uses:

| Application card | Icon              | Header gradient                                     |
| ---------------- | ----------------- | --------------------------------------------------- |
| AIStore          | `StorageIcon`     | `linear-gradient(135deg, #667eea 0%, #764ba2 100%)` |
| DetectionHub     | `CloudUploadIcon` | `linear-gradient(135deg, #f093fb 0%, #f5576c 100%)` |
| SRI AML          | `SecurityIcon`    | `linear-gradient(135deg, #b71c1c 0%, #7f1d1d 100%)` |

The card currently hides the old gradient stripe with `cardStripe: { display: 'none' }`; the gradient remains part of the card metadata and should be preserved if the same design is being recreated.

#### SRI component cards

[`SriDeploymentHubPage.tsx`](../plugins/platform-home/src/components/SriDeploymentHubPage.tsx) centralizes the mapping in `SRI_CARD_META`:

| Component ID        | Icon               | Accent    |
| ------------------- | ------------------ | --------- |
| `common-res`        | `LayersIcon`       | `#0F766E` |
| `ai-store`          | `StorageIcon`      | `#667EEA` |
| `netreveal-v96`     | `CloudQueueIcon`   | `#1565C0` |
| `sri-investigation` | `FindInPageIcon`   | `#6A1B9A` |
| `flows`             | `AccountTreeIcon`  | `#00838F` |
| `sensaai-sanctions` | `GavelIcon`        | `#C62828` |
| `sri-detection`     | `SecurityIcon`     | `#EF6C00` |
| `hybrid-manager`    | `FolderSharedIcon` | `#2E7D32` |
| `sri-data`          | `DataUsageIcon`    | `#455A64` |
| `sri-agents`        | `ExtensionIcon`    | `#AD1457` |
| `netreveal`         | `PeopleIcon`       | `#3949AB` |
| Unknown component   | `BuildIcon`        | `#1D4ED8` |

`SriPage.tsx` maintains the equivalent service-card mapping and falls back to `StorageIcon` for an unknown service ID.

#### Template category cards

[`TemplatesCatalogPage.tsx`](../packages/app/src/components/TemplatesCatalogPage.tsx) uses these category icons and gradients:

| Category  | Icon              | Gradient               |
| --------- | ----------------- | ---------------------- |
| All       | `AppsIcon`        | `#374151` to `#6B7280` |
| Provision | `CloudQueueIcon`  | `#4C1480` to `#6B21A8` |
| Deploy    | `CloudUploadIcon` | `#1E40AF` to `#3B82F6` |
| Operate   | `SettingsIcon`    | `#B45309` to `#D97706` |
| Secure    | `LockIcon`        | `#0F766E` to `#14B8A6` |
| Observe   | `BarChartIcon`    | `#0369A1` to `#0EA5E9` |

The category icon is used in navigation/data metadata; the card header itself primarily uses the category gradient and text.

### 2. CloudHub Logo Mark

`LogoIcon.tsx` contains the CloudHub mark as a large inline SVG:

- `viewBox`: `0 0 337.46 428.5`
- Rendered height: `28px`
- Fill: `#111827`
- Background: `#FFFFFF` with `4px` padding and a `4px` border radius
- The logo is a `<path>` in the component; there is no `.svg`, `.png`, or remote URL.

To reuse it, copy the `LogoIcon` component or move it into a shared package. Do not replace it with a different downloaded logo if visual parity is required. `SidebarLogo.tsx` selects this mark when the sidebar is collapsed and `LogoFull.tsx` when it is open.

The full wordmark is text, not an image. Its label is `Symphony Cloud Platform` and its styles use a `Poppins, Segoe UI, sans-serif` stack in the current implementation. It uses dark text on the same white logo tile.

### 3. Microsoft Sign-In Logo

`CloudHubSignInPage.tsx` defines `MicrosoftLogo()` as a 4-square inline SVG:

- Size: `18 x 18px`
- `viewBox`: `0 0 21 21`
- Red: `#F25022`
- Green: `#7FBA00`
- Blue: `#00A4EF`
- Yellow: `#FFB900`

It is rendered inside the Microsoft sign-in button. It is not fetched at runtime and does not require an image URL. The component uses the accessible `aria-hidden="true"` attribute because the adjacent button text supplies the label.

For a different product, confirm that the product is allowed to use Microsoft's brand assets and follow the current Microsoft brand guidance before changing the mark or colors.

### 4. Text And CSS Visuals

Several cards use visual identity without an image:

- Gradient backgrounds stored as strings in card metadata.
- Solid icon accent colors.
- Light tinted icon containers.
- CSS shadows, borders, radius, and hover transforms.
- Text labels such as `AIStore`, `DetectionHub`, `SRI AML`, and `Symphony Cloud Platform`.
- Landing dashboard cards use a monochrome treatment: white surface, `#D1D5DB` border, dark `#111827` icon/title, and muted `#4B5563` description.

There are no card-specific calls to `fetch`, remote image hosts, `background-image: url(...)`, or `<img src="...">` in these implementations.

## Where Assets Download From

| Asset                | Runtime download                                                                   | Development dependency/source                                                |
| -------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| MUI card icons       | No image download. The browser receives the bundled icon component output.         | `@mui/icons-material` from npm; version range is in the root `package.json`. |
| CloudHub logo        | No download. Inline SVG is bundled into the JavaScript.                            | `packages/app/src/modules/nav/LogoIcon.tsx`                                  |
| Microsoft logo       | No download. Inline SVG is bundled into the JavaScript.                            | `packages/app/src/components/CloudHubSignInPage.tsx`                         |
| Gradients/colors     | No download. CSS-in-JS emits CSS in the page.                                      | Card metadata and `makeStyles` definitions in the source files               |
| SRI Provisioner page | The browser navigates to `https://sri-provisioner.invhub.fseng.net/` in a new tab. | External deployment portal; CloudHub downloads no logo asset                 |

The official Material UI icon documentation is available at <https://mui.com/material-ui/material-icons/>. If the new project does not use Material UI, use the corresponding SVG paths from the Material Icons package or install an equivalent icon library, but keep the icon names and sizing consistent.

## Reusing The Same Cards In Another React Project

### Option A: The new project already uses Material UI

Install compatible packages:

```bash
yarn add @mui/material @mui/icons-material @emotion/react @emotion/styled
```

Then import icons exactly as CloudHub does:

```tsx
import StorageIcon from '@mui/icons-material/Storage';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import SecurityIcon from '@mui/icons-material/Security';
```

Keep the icon as a component in card data rather than storing a string and dynamically constructing an import:

```tsx
type CardDefinition = {
  id: string;
  title: string;
  description: string;
  Icon: React.ElementType;
  accent: string;
  gradient?: string;
};

const cards: CardDefinition[] = [
  {
    id: 'ai-store',
    title: 'AIStore',
    description: 'Data storage and retrieval operations.',
    Icon: StorageIcon,
    accent: '#667EEA',
    gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  },
];
```

Render the icon as a component and apply the same stable card geometry:

```tsx
<Card
  sx={{
    height: 238,
    borderRadius: 1,
    border: '1px solid #E5E7EB',
    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.08)',
    transition: 'box-shadow 0.2s, transform 0.15s',
    '&:hover': {
      boxShadow: '0 6px 16px rgba(15, 23, 42, 0.12)',
      transform: 'translateY(-2px)',
    },
  }}
>
  <CardActionArea
    sx={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'stretch',
    }}
  >
    <CardContent
      sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}
    >
      <card.Icon sx={{ fontSize: '2.7rem', color: card.accent }} />
      <Typography sx={{ fontSize: '1.1rem', fontWeight: 700 }}>
        {card.title}
      </Typography>
      <Typography sx={{ flex: 1, fontSize: '0.85rem', lineHeight: 1.5 }}>
        {card.description}
      </Typography>
    </CardContent>
  </CardActionArea>
</Card>
```

In JSX, use an uppercase local variable when rendering a component stored in data:

```tsx
const CardIcon = card.Icon;
return <CardIcon />;
```

### Option B: The new project does not use Material UI

Use one of these approaches:

1. Install `@mui/icons-material` and its peer dependencies solely for visual parity.
2. Copy the required icon SVG implementations into a local, reviewed icon component package.
3. Use another icon library only if exact visual parity is not required.

Do not use Unicode emoji or arbitrary image URLs as substitutes. They will differ across operating systems and will not match the CloudHub cards.

For the CloudHub and Microsoft marks, copy the inline SVG components directly. Preserve the `viewBox`, path/rect geometry, fill colors, and dimensions. Inline SVG is preferable here because it keeps the logo independent of a public asset host.

## Card Design Tokens To Preserve

These values are the most important for reproducing the current card appearance:

```ts
const CARD_TOKENS = {
  height: 238,
  radius: 8,
  background: '#FFFFFF',
  border: '#D1D5DB',
  shadow: '0 1px 3px rgba(15, 23, 42, 0.08)',
  hoverShadow: '0 6px 16px rgba(15, 23, 42, 0.12)',
  hoverTransform: 'translateY(-2px)',
  iconSize: '2.7rem',
  iconColor: '#111827',
  descriptionColor: '#4B5563',
  titleSize: '1.1rem',
  descriptionSize: '0.85rem',
  descriptionLineHeight: 1.5,
} as const;
```

For dashboard quick-action cards, use the monochrome tokens above. SRI application cards remain a separate family with their own metadata gradients.

## Accessibility Requirements

- Treat icons as decorative when the card title already labels the action: use `aria-hidden="true"` or the icon library's equivalent.
- Give the card action a visible text label such as `Deploy`, `Create Cluster`, or `View Registry`.
- Keep the whole card keyboard reachable when it is clickable by using `CardActionArea`, a real link, or a real button.
- Do not encode the card's meaning only in color; keep the title and description visible.
- Preserve the adjacent text label for the Microsoft sign-in logo.

## Reuse Checklist

- [ ] Install or select the icon implementation before copying card data.
- [ ] Copy the correct card family: dashboard, SRI application, SRI component, or template category.
- [ ] For SRI Provisioner, use the external URL and open it with `noopener,noreferrer`.
- [ ] Copy the icon mapping and fallback behavior.
- [ ] Copy the exact accent and gradient values for the selected family.
- [ ] Copy the card dimensions, border, shadow, spacing, and hover behavior.
- [ ] Copy `LogoIcon` only when the CloudHub mark is needed.
- [ ] Copy `MicrosoftLogo` only for the Microsoft sign-in control, and review Microsoft's current brand requirements.
- [ ] Do not add a CDN, image download, or public asset route unless the new project introduces a genuinely new raster asset.
- [ ] Verify keyboard focus, responsive card height, contrast, and the rendering of every icon at the target browser sizes.

## What To Change When Adding A New Card

Add a new data entry to the appropriate source map or array rather than duplicating JSX:

- Dashboard and quick links: `PlatformHomePage.tsx`.
- SRI application cards: `SriDeployPage.tsx`.
- SRI component cards: `SriDeploymentHubPage.tsx` and `SriPage.tsx`.
- Template categories: `TemplatesCatalogPage.tsx`.

Use a known MUI icon and keep landing dashboard cards monochrome. If the card needs a real product logo, first decide whether it should be an inline SVG, a checked-in local asset, or a separately licensed remote asset. Document that new source in this guide and do not silently introduce a runtime download.
