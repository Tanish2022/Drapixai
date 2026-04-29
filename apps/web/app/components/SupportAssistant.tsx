'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, LifeBuoy, Mail, MessageSquare, Send, Sparkles, X } from 'lucide-react';

type SupportLink = {
  href: string;
  label: string;
};

type SupportTopic = {
  id: string;
  title: string;
  summary: string;
  keywords: string[];
  links: SupportLink[];
};

type ChatMessage =
  | {
      role: 'assistant';
      id: string;
      title: string;
      summary: string;
      links: SupportLink[];
    }
  | {
      role: 'user';
      id: string;
      body: string;
    };

const supportTopics: SupportTopic[] = [
  {
    id: 'garment-upload',
    title: 'Garment upload help',
    summary:
      'Start with garment-only upper-body images on plain backgrounds. DrapixAI should validate those assets first, before product discovery or storefront install enters the conversation.',
    keywords: ['garment', 'upload', 'rejected', 'image', 'background', 'product prep', 'asset', 'cache'],
    links: [
      { href: '/dashboard#garment-onboarding', label: 'Open product and garment prep' },
      { href: '/help#garments-images', label: 'Read garment image help' },
    ],
  },
  {
    id: 'catalog-discovery',
    title: 'Catalog discovery help',
    summary:
      'After garment validation, bring in a small product list or feed so DrapixAI has product context. Discovery should happen before suggested matches or live install.',
    keywords: ['catalog', 'discovery', 'feed', 'products', 'import', 'csv', 'discover', 'sync'],
    links: [
      { href: '/dashboard#garment-onboarding', label: 'Open discovery tools' },
      { href: '/help#integration-help', label: 'Read discovery and integration help' },
    ],
  },
  {
    id: 'matches-confirmation',
    title: 'Suggested matches and confirmation',
    summary:
      'DrapixAI should suggest likely garment-to-product links after discovery, then a human confirms the right pairings before the storefront depends on them.',
    keywords: ['match', 'matches', 'suggested', 'suggestions', 'confirm', 'confirmation', 'pairing', 'mapping'],
    links: [
      { href: '/help#matches-confirmation', label: 'Read match confirmation help' },
      { href: '/docs#confirmed-mappings', label: 'Open confirmed mapping docs' },
    ],
  },
  {
    id: 'store-verification',
    title: 'Store verification help',
    summary:
      'Save the store URL first, then add the verification meta tag only when you are ready for live domain setup. Verification is later than garment validation, discovery, and confirmation.',
    keywords: ['store', 'verify', 'verification', 'domain', 'meta', 'homepage', 'live', 'settings'],
    links: [
      { href: '/settings', label: 'Open store settings' },
      { href: '/help#integration-help', label: 'Read integration help' },
    ],
  },
  {
    id: 'weak-results',
    title: 'Weak or unrealistic try-on results',
    summary:
      'Most weak results come from poor garment assets or weak person images. Use clean front-facing person photos and garment-only upper-body assets with accurate color and lighting.',
    keywords: ['result', 'weak', 'realistic', 'quality', 'output', 'bad', 'wrong', 'color', 'fit', 'preview'],
    links: [
      { href: '/help#tryon-results', label: 'Read try-on quality guidance' },
      { href: '/dashboard#plugin-demo', label: 'Open internal preview' },
    ],
  },
  {
    id: 'sdk-install',
    title: 'SDK installation help',
    summary:
      'Use the docs when you are ready to install on a storefront. The SDK should use confirmed mappings only after internal preview and confirmation are trusted.',
    keywords: ['sdk', 'install', 'script', 'button', 'widget', 'auto attach', 'single product', 'storefront', 'docs'],
    links: [
      { href: '/docs', label: 'Open SDK docs' },
      { href: '/docs#single-product', label: 'Single product install' },
      { href: '/docs#auto-attach', label: 'Auto attach install' },
    ],
  },
  {
    id: 'billing-support',
    title: 'Plan, quota, and billing help',
    summary:
      'Use the trial or current plan to validate your workflow first. Check remaining quota and plan details in Subscription, and use contact support for guided rollout or commercial questions.',
    keywords: ['billing', 'plan', 'pricing', 'quota', 'trial', 'renders', 'subscription', 'upgrade'],
    links: [
      { href: '/subscription', label: 'Open subscription' },
      { href: '/pricing', label: 'View pricing' },
      { href: '/contact', label: 'Contact support' },
    ],
  },
  {
    id: 'getting-started',
    title: 'Best first steps',
    summary:
      'The easiest path is: upload garments, validate them, discover products, review suggested matches, confirm the right pairings, then run one believable preview before any live storefront setup.',
    keywords: ['start', 'onboarding', 'begin', 'first', 'setup', 'how do i start', 'quick', 'easy'],
    links: [
      { href: '/dashboard', label: 'Open guided dashboard' },
      { href: '/settings', label: 'Open settings' },
      { href: '/help#getting-started', label: 'Read getting started' },
    ],
  },
];

const quickPrompts = [
  'How do I start?',
  'Why was my garment rejected?',
  'How does catalog discovery work?',
  'How do suggested matches work?',
  'How do I verify my store?',
  'My result looks weak',
  'How do I install the SDK?',
];

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');

const findSupportTopic = (query: string) => {
  const normalizedQuery = normalize(query);
  const matches = supportTopics
    .map((topic) => {
      const score = topic.keywords.reduce((total, keyword) => {
        const normalizedKeyword = normalize(keyword).trim();
        if (!normalizedKeyword) return total;
        return normalizedQuery.includes(normalizedKeyword) ? total + normalizedKeyword.split(' ').length : total;
      }, 0);

      return { topic, score };
    })
    .sort((left, right) => right.score - left.score);

  return matches[0]?.score ? matches[0].topic : null;
};

const fallbackResponse: Omit<Extract<ChatMessage, { role: 'assistant' }>, 'id'> = {
  role: 'assistant',
  title: 'Support path',
  summary:
    'I could not match that cleanly yet. The fastest next step is to open the Help Center or Docs for guided setup, and use email support if the issue is account-specific or blocking.',
  links: [
    { href: '/help', label: 'Open Help Center' },
    { href: '/docs', label: 'Open Docs' },
    { href: 'mailto:support@drapixai.com', label: 'Email support@drapixai.com' },
  ],
};

export default function SupportAssistant() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      id: 'welcome',
      title: 'DrapixAI support assistant',
      summary:
        'Ask about onboarding, garment validation, catalog discovery, suggested matches, confirmation, store verification, result quality, or SDK install. I will point you to the right page and the next best action.',
      links: [
        { href: '/help', label: 'Open Help Center' },
        { href: '/docs', label: 'Open Docs' },
      ],
    },
  ]);

  const sendMessage = (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message) return;

    const topic = findSupportTopic(message);
    const assistantReply = topic
      ? {
          role: 'assistant' as const,
          id: `assistant-${Date.now() + 1}`,
          title: topic.title,
          summary: topic.summary,
          links: [...topic.links, { href: 'mailto:support@drapixai.com', label: 'Email support' }],
        }
      : {
          ...fallbackResponse,
          id: `assistant-${Date.now() + 1}`,
        };

    setMessages((current) => [
      ...current,
      { role: 'user', id: `user-${Date.now()}`, body: message },
      assistantReply,
    ]);
    setInput('');
    setIsOpen(true);
  };

  const hideAssistant = pathname === '/auth/login' || pathname === '/auth/register';
  if (hideAssistant) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="fixed bottom-6 right-6 z-[70] inline-flex h-14 w-14 items-center justify-center rounded-full border border-cyan-400/30 bg-[#0b1120]/92 text-white shadow-[0_16px_48px_rgba(0,0,0,0.35)] backdrop-blur-xl transition-colors hover:bg-[#121a2b]"
        aria-label={isOpen ? 'Close support assistant' : 'Open support assistant'}
        title={isOpen ? 'Close support assistant' : 'Open support assistant'}
      >
        <LifeBuoy className="h-6 w-6 text-cyan-300" />
      </button>

      {isOpen ? (
        <div className="fixed bottom-24 right-6 z-[70] w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded-[28px] border border-white/[0.08] bg-[#07101f]/95 shadow-[0_24px_70px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          <div className="border-b border-white/[0.08] bg-[linear-gradient(135deg,rgba(34,211,238,0.14),rgba(59,130,246,0.12))] px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm uppercase tracking-[0.24em] text-cyan-300/80">Support</p>
                <h2 className="mt-1 text-lg font-semibold text-white">DrapixAI assistant</h2>
                <p className="mt-2 text-sm leading-6 text-gray-300">
                  Quick help for onboarding, docs, and the confirmed mapping flow. For account-specific issues, email support is one click away.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-xl border border-white/[0.08] bg-black/20 p-2 text-gray-300 transition-colors hover:bg-white/[0.06] hover:text-white"
                aria-label="Close support assistant"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="max-h-[420px] space-y-4 overflow-y-auto px-4 py-4">
            {messages.map((message) =>
              message.role === 'user' ? (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl bg-cyan-500/15 px-4 py-3 text-sm leading-6 text-cyan-50">
                    {message.body}
                  </div>
                </div>
              ) : (
                <div key={message.id} className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-4">
                  <div className="flex items-center gap-2 text-cyan-300">
                    <Sparkles className="h-4 w-4" />
                    <span className="text-sm font-medium">{message.title}</span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-gray-200">{message.summary}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {message.links.map((link) =>
                      link.href.startsWith('mailto:') ? (
                        <a
                          key={`${message.id}-${link.href}`}
                          href={link.href}
                          className="inline-flex items-center gap-2 rounded-xl border border-white/[0.10] px-3 py-2 text-xs text-gray-100 transition-colors hover:bg-white/[0.06]"
                        >
                          <Mail className="h-3.5 w-3.5" />
                          {link.label}
                        </a>
                      ) : (
                        <Link
                          key={`${message.id}-${link.href}`}
                          href={link.href}
                          className="inline-flex items-center gap-2 rounded-xl border border-white/[0.10] px-3 py-2 text-xs text-gray-100 transition-colors hover:bg-white/[0.06]"
                        >
                          {link.label}
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      )
                    )}
                  </div>
                </div>
              )
            )}
          </div>

          <div className="border-t border-white/[0.08] px-4 py-4">
            <div className="mb-3 flex flex-wrap gap-2">
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => sendMessage(prompt)}
                  className="rounded-full border border-white/[0.10] bg-white/[0.03] px-3 py-1.5 text-xs text-gray-200 transition-colors hover:bg-white/[0.06]"
                >
                  {prompt}
                </button>
              ))}
            </div>

            <div className="flex items-end gap-3">
              <div className="flex-1 rounded-2xl border border-white/[0.08] bg-black/25 px-4 py-3">
                <label htmlFor="support-assistant-input" className="sr-only">
                  Ask support assistant
                </label>
                <textarea
                  id="support-assistant-input"
                  rows={2}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      sendMessage(input);
                    }
                  }}
                  placeholder="Ask about onboarding, garments, store verification, docs, or billing..."
                  
                  className="w-full resize-none bg-transparent text-sm leading-6 text-white outline-none placeholder:text-gray-500"
                />
              </div>
              <button
                type="button"
                onClick={() => sendMessage(input)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-r from-cyan-400 to-blue-500 text-white transition-opacity hover:opacity-90"
                aria-label="Send support question"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3 text-xs text-gray-400">
              <span className="inline-flex items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5" />
                Guided answers from your current help and docs content
              </span>
              <a href="mailto:support@drapixai.com" className="text-cyan-300 hover:text-cyan-200">
                support@drapixai.com
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
