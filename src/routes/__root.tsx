import { TanStackDevtools } from '@tanstack/react-devtools';
import { createRootRoute, HeadContent, Link, Scripts } from '@tanstack/react-router';
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools';
import { ThemeProvider } from 'next-themes';
import appCss from '../styles.css?url';

const THEME_MIGRATION_SCRIPT = `try{var theme=localStorage.getItem('theme');if(theme&&!['light','dark','system'].includes(theme))localStorage.removeItem('theme')}catch{}`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Weave AI',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: () => (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">404 · 页面不存在</h1>
      <Link to="/" className="text-primary underline underline-offset-4">
        返回首页
      </Link>
    </main>
  ),
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* eslint-disable-next-line react/dom-no-dangerously-set-innerhtml -- static theme migration script runs before hydration. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_MIGRATION_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  );
}
