# Static Assets for Email Templates

This directory contains static assets used in email templates.

## Files

- `logo.svg` - Application logo used in email templates

## Usage in Email Templates

The logo is referenced in email templates using the base URL:

```typescript
const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

<Img
    src={`${baseUrl}/static/logo.svg`}
    width="120"
    height="120"
    alt="Logo"
/>
```

## Environment Variables

Make sure to set `NEXT_PUBLIC_APP_URL` in your environment:

```env
NEXT_PUBLIC_APP_URL=https://yourapp.com
```

## Email Client Compatibility

- SVG support varies across email clients
- Gmail: Limited SVG support (may not display)
- Outlook: No SVG support
- Apple Mail: Good SVG support

### Recommendation

For maximum compatibility, consider converting the logo to PNG format:

1. Export `logo.svg` as `logo.png` (recommended size: 240x240px for retina displays)
2. Update email template to use `logo.png` instead of `logo.svg`

```typescript
<Img
    src={`${baseUrl}/static/logo.png`}
    width="120"
    height="120"
    alt="Logo"
/>
```

## Current Directory Structure

```
public/
├── static/
│   ├── logo.svg       # SVG logo (current)
│   └── logo.png       # PNG logo (recommended for emails)
├── jpeg/
├── png/
└── webp/
```
