import { createRootRoute, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import appCss from "../styles.css?url";

const APP_NAME = "Kyrona";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Kyrona — spending limits before you send" },
      {
        name: "description",
        content: "Set who you pay, how much, and a daily limit. Kyrona blocks the payment before money leaves.",
      },
      { name: "theme-color", content: "#003834" },
    ],
    links: [
      { rel: "icon", type: "image/png", href: "/logo.png" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap",
      },
    ],
  }),
  component: () => (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
            "globalThis.global=globalThis;globalThis.process=globalThis.process||{env:{},browser:true,version:'',versions:{}};try{var t=localStorage.getItem('kyrona-theme');if(t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');var m=document.querySelector('meta[name=theme-color]');if(m)m.setAttribute('content','#071614');}}catch(e){}",
          }}
        />
        <HeadContent />
      </head>
      <body>
        <PreviewHostBridge />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
  notFoundComponent: NotFound,
});

function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="grid max-w-sm justify-items-center text-center">
        <img src="/logo.png" alt="" className="h-12 w-auto" />
        <p className="kicker mt-8">404</p>
        <h1 className="display mt-3 text-4xl">This page is not here.</h1>
        <p className="mt-3 text-sm text-muted">The desk is on the home page.</p>
        <Link to="/" className="btn btn-ink mt-6">
          Back to the desk
        </Link>
      </div>
    </main>
  );
}
