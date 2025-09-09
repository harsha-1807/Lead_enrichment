import type { Metadata } from 'next';
import { Montserrat } from 'next/font/google';
import '../globals.css';
import { cn } from '@/lib/utils';
import { Toaster } from 'sonner';
import ThemeProvider from '@/components/theme/Provider';
import Script from 'next/script';

const montserrat = Montserrat({
  weight: ['300', '400', '500', '700'],
  subsets: ['latin'],
  display: 'swap',
  fallback: ['Arial', 'sans-serif'],
});

export const metadata: Metadata = {
  title: 'CRM Lead Assistant AI',
  description:
    'An AI assistant that helps you manage and enrich your CRM leads efficiently.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html className="h-full" lang="en" suppressHydrationWarning>
      <head>
       <link
    href="https://fonts.googleapis.com/css2?family=Geist&family=Geist+Mono&display=swap"
    rel="stylesheet"
  />
        <Script src="https://live.zwidgets.com/js-sdk/1.0/ZohoEmbededAppSDK.min.js"/>
      </head>
      <body className={cn('h-full', montserrat.className)}>
        <ThemeProvider>
          <Toaster
            toastOptions={{
              unstyled: true,
              classNames: {
                toast:
                  'bg-light-primary dark:bg-dark-secondary dark:text-white/70 text-black-70 rounded-lg p-4 flex flex-row items-center space-x-2',
              },
            }}
          />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
