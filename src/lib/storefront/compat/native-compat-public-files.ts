/** Static data fixtures, kept separate from /robots.txt's server-route fixture. */
export const NATIVE_COMPAT_PUBLIC_FILES = [
  {
    path: "public/compat-static/robots.txt",
    content: "User-agent: *\r\nDisallow:\r\n",
    mimeType: "text/plain",
  },
  {
    path: "public/compat-static/sitemap.xml",
    content:
      '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://shop.example/</loc></url></urlset>',
    mimeType: "application/xml",
  },
  {
    path: "public/compat-static/data.json",
    content: '{"hello":"世界"}\n',
    mimeType: "application/json",
  },
  {
    path: "public/compat-static/site.webmanifest",
    content: '{"name":"Shop"}\n',
    mimeType: "application/manifest+json",
  },
] as const;
