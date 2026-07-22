'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, Mail, MessageSquare, Send, Sparkles, X } from 'lucide-react';

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
      { href: '/help#garments-images', label: 'Open garment guidance' },
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
      { href: '/help#integration-help', label: 'Open discovery and integration guidance' },
    ],
  },
  {
    id: 'matches-confirmation',
    title: 'Suggested matches and confirmation',
    summary:
      'DrapixAI should suggest likely garment-to-product links after discovery, then a human confirms the right pairings before the storefront depends on them.',
    keywords: ['match', 'matches', 'suggested', 'suggestions', 'confirm', 'confirmation', 'pairing', 'mapping'],
    links: [
      { href: '/help#matches-confirmation', label: 'Open match confirmation guidance' },
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
      { href: '/help#integration-help', label: 'Open integration guidance' },
    ],
  },
  {
    id: 'weak-results',
    title: 'Weak or unrealistic try-on results',
    summary:
      'Most weak results come from poor garment assets or weak person images. Use clean front-facing person photos and garment-only upper-body assets with accurate color and lighting.',
    keywords: ['result', 'weak', 'realistic', 'quality', 'output', 'bad', 'wrong', 'color', 'fit', 'preview'],
    links: [
      { href: '/help#tryon-results', label: 'Open try-on quality guidance' },
      { href: '/dashboard#plugin-demo', label: 'Open internal preview' },
    ],
  },
  {
    id: 'sdk-install',
    title: 'SDK installation help',
    summary:
      'Use the Help page when you are ready to install on a storefront. The SDK should use confirmed mappings only after internal preview and confirmation are trusted.',
    keywords: ['sdk', 'install', 'script', 'button', 'widget', 'auto attach', 'single product', 'storefront', 'docs'],
    links: [
      { href: '/help#integration-help', label: 'Open Help' },
      { href: '/help#integration-help', label: 'Single product install' },
      { href: '/help#integration-help', label: 'Auto attach install' },
    ],
  },
  {
    id: 'billing-support',
    title: 'Plan, quota, and billing help',
    summary:
      'Use the trial or current plan to validate your workflow first. If the account has reached its try-on limit, stop rollout, review the Subscription page, and upgrade or contact sales before continuing.',
    keywords: ['billing', 'plan', 'pricing', 'quota', 'trial', 'renders', 'subscription', 'upgrade', 'limit reached', 'quota exhausted', 'no try-ons left'],
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
      { href: '/help#getting-started', label: 'Open getting started help' },
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
const greetingKeywords = ['hi', 'hii', 'hello', 'hey', 'hey there', 'hi there', 'good morning', 'good afternoon', 'good evening'];
const thanksKeywords = ['thanks', 'thank you', 'thx', 'ty', 'thanks a lot', 'thankyou'];
const acknowledgementKeywords = ['ok', 'okay', 'okk', 'got it', 'understood', 'cool', 'alright', 'all right', 'fine'];
const farewellKeywords = ['bye', 'goodbye', 'see you', 'see ya', 'talk later', 'bye bye'];
const helpKeywords = ['help', 'can you help', 'need help', 'support'];

const normalizeQuery = (query: string) => normalize(query).trim().replace(/\s+/g, ' ');

const isGreetingMessage = (query: string) => {
  const normalizedQuery = normalizeQuery(query);
  return greetingKeywords.includes(normalizedQuery);
};

const isThanksMessage = (query: string) => {
  const normalizedQuery = normalizeQuery(query);
  return thanksKeywords.includes(normalizedQuery);
};

const isAcknowledgementMessage = (query: string) => {
  const normalizedQuery = normalizeQuery(query);
  return acknowledgementKeywords.includes(normalizedQuery);
};

const isFarewellMessage = (query: string) => {
  const normalizedQuery = normalizeQuery(query);
  return farewellKeywords.includes(normalizedQuery);
};

const isSimpleHelpMessage = (query: string) => {
  const normalizedQuery = normalize(query).trim().replace(/\s+/g, ' ');
  return helpKeywords.includes(normalizedQuery);
};

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
    'I could not match that cleanly yet. The fastest next step is to open DrapixAI Help for guided setup, and use email support if the issue is account-specific or blocking.',
  links: [
    { href: '/help', label: 'Open Help' },
    { href: 'mailto:support@drapixai.com', label: 'Email support@drapixai.com' },
  ],
};

const greetingResponse: Omit<Extract<ChatMessage, { role: 'assistant' }>, 'id'> = {
  role: 'assistant',
  title: 'Hello',
  summary:
    'Hi there. I can help with onboarding, garment validation, catalog discovery, suggested matches, store verification, SDK setup, pricing, or quota questions. Ask me what you need and I will point you to the right next step.',
  links: [
    { href: '/dashboard', label: 'Open dashboard' },
    { href: '/help', label: 'Open Help' },
  ],
};

const thanksResponse: Omit<Extract<ChatMessage, { role: 'assistant' }>, 'id'> = {
  role: 'assistant',
  title: 'You’re welcome',
  summary:
    'Happy to help. If you want, ask the next question directly and I’ll keep pointing you to the right onboarding, docs, pricing, or support step.',
  links: [
    { href: '/dashboard', label: 'Open dashboard' },
    { href: '/help', label: 'Open Help' },
  ],
};

const acknowledgementResponse: Omit<Extract<ChatMessage, { role: 'assistant' }>, 'id'> = {
  role: 'assistant',
  title: 'Sounds good',
  summary:
    'Whenever you are ready, ask the next question about onboarding, garments, store setup, SDK installation, pricing, or quota and I’ll guide you from there.',
  links: [
    { href: '/dashboard', label: 'Open dashboard' },
    { href: '/help', label: 'Open Help' },
  ],
};

const farewellResponse: Omit<Extract<ChatMessage, { role: 'assistant' }>, 'id'> = {
  role: 'assistant',
  title: 'Talk soon',
  summary:
    'Any time you come back, I can help with garments, discovery, suggested matches, store verification, SDK setup, or billing questions.',
  links: [
    { href: '/help', label: 'Open Help' },
    { href: 'mailto:support@drapixai.com', label: 'Email support' },
  ],
};

const helpResponse: Omit<Extract<ChatMessage, { role: 'assistant' }>, 'id'> = {
  role: 'assistant',
  title: 'How I can help',
  summary:
    'I can help with onboarding, garment validation, catalog discovery, suggested matches, manual confirmation, store verification, result quality, SDK setup, pricing, and quota questions.',
  links: [
    { href: '/dashboard', label: 'Open dashboard' },
    { href: '/help', label: 'Open Help' },
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
        { href: '/help', label: 'Open Help' },
      ],
    },
  ]);
  const hasUserMessages = messages.some((message) => message.role === 'user');

  const sendMessage = (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message) return;

    const topic = findSupportTopic(message);
    const assistantReply = isGreetingMessage(message)
      ? {
          ...greetingResponse,
          id: `assistant-${Date.now() + 1}`,
        }
      : isThanksMessage(message)
      ? {
          ...thanksResponse,
          id: `assistant-${Date.now() + 1}`,
        }
      : isAcknowledgementMessage(message)
      ? {
          ...acknowledgementResponse,
          id: `assistant-${Date.now() + 1}`,
        }
      : isFarewellMessage(message)
      ? {
          ...farewellResponse,
          id: `assistant-${Date.now() + 1}`,
        }
      : isSimpleHelpMessage(message)
      ? {
          ...helpResponse,
          id: `assistant-${Date.now() + 1}`,
        }
      : topic
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

  const hideAssistant = pathname.startsWith('/auth/')
    || pathname.startsWith('/admin')
    || pathname.startsWith('/shopify/')
    || ['/dashboard', '/sdk-install', '/settings', '/subscription'].includes(pathname);
  if (hideAssistant) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className={isOpen ? 'hidden' : 'fixed bottom-4 right-4 z-[70] inline-flex h-12 w-12 items-center justify-center rounded-full border border-black/15 bg-[#fbfcf9] text-[#1f6048] shadow-[0_12px_36px_rgba(24,40,31,0.18)] transition-colors hover:bg-[#e7eee8] sm:bottom-6 sm:right-6'}
        aria-label={isOpen ? 'Close support assistant' : 'Open support assistant'}
        title={isOpen ? 'Close support assistant' : 'Open support assistant'}
      >
        <MessageSquare className="h-5 w-5" />
      </button>

      {isOpen ? (
        <div className="fixed inset-x-3 bottom-3 top-3 z-[70] flex flex-col overflow-hidden rounded-lg border border-black/15 bg-[#fbfcf9] text-[#172019] shadow-[0_24px_70px_rgba(24,40,31,0.22)] sm:inset-x-auto sm:bottom-24 sm:right-6 sm:top-auto sm:max-h-[calc(100vh-7rem)] sm:w-[420px]">
          <div className="border-b border-black/10 bg-[#b8d8c7] px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase text-[#276149]">Support</p>
                <h2 className="mt-1 text-lg font-semibold text-[#172019]">DrapixAI assistant</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center border border-black/15 bg-white/50 text-[#475349] transition-colors hover:bg-white"
                aria-label="Close support assistant"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {messages.map((message) =>
              message.role === 'user' ? (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-md bg-[#d9ecdf] px-4 py-3 text-sm leading-6 text-[#173d2f]">
                    {message.body}
                  </div>
                </div>
              ) : (
                <div key={message.id} className="rounded-md border border-black/10 bg-white px-4 py-4">
                  <div className="flex items-center gap-2 text-[#21634e]">
                    <Sparkles className="h-4 w-4" />
                    <span className="text-sm font-medium">{message.title}</span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[#4e5a51]">{message.summary}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {message.links.map((link) =>
                      link.href.startsWith('mailto:') ? (
                        <a
                          key={`${message.id}-${link.href}`}
                          href={link.href}
                          className="inline-flex min-h-10 items-center gap-2 rounded-md border border-black/15 px-3 py-2 text-xs text-[#344038] transition-colors hover:bg-[#eef2ec]"
                        >
                          <Mail className="h-3.5 w-3.5" />
                          {link.label}
                        </a>
                      ) : (
                        <Link
                          key={`${message.id}-${link.href}`}
                          href={link.href}
                          className="inline-flex min-h-10 items-center gap-2 rounded-md border border-black/15 px-3 py-2 text-xs text-[#344038] transition-colors hover:bg-[#eef2ec]"
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

          <div className="border-t border-black/10 px-4 py-4">
            {!hasUserMessages ? (
              <div className="mb-3 flex flex-wrap gap-2">
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => sendMessage(prompt)}
                    className="min-h-10 rounded-md border border-black/15 bg-white px-3 py-2 text-xs text-[#475349] transition-colors hover:bg-[#eef2ec]"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="flex items-end gap-3">
              <div className="flex-1 rounded-md border border-black/15 bg-white px-4 py-3">
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
                  
                  className="w-full resize-none bg-transparent text-sm leading-6 text-[#172019] outline-none placeholder:text-[#7c887f]"
                />
              </div>
              <button
                type="button"
                onClick={() => sendMessage(input)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-md bg-[#183f32] text-white transition-colors hover:bg-[#245a48]"
                aria-label="Send support question"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[#6a756c]">
              <span className="inline-flex min-w-0 items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5" />
                <span className="truncate">Guided answers from your current Help content</span>
              </span>
              <a href="mailto:support@drapixai.com" className="shrink-0 font-medium text-[#21634e] hover:text-[#153f31]">
                support@drapixai.com
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
