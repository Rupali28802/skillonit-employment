'use client';

import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import Link from 'next/link';
import { Bot, MessageCircle, Minus, RotateCcw, Send, X } from 'lucide-react';
import { readBrowserApiPayload } from '@/lib/browser-api';

type SupportLink = { label: string; href: string };
type Message = {
  id: number;
  role: 'bot' | 'user';
  text: string;
  links?: SupportLink[];
  failed?: boolean;
};

const suggestions = [
  'How do I create my profile?',
  'How do I upload my CV?',
  'How does job matching work?',
  'How do I connect Gmail?',
];

const welcome: Message = {
  id: 0,
  role: 'bot',
  text: 'Hi! I’m the SkillOnIT support assistant. I can help you understand and navigate the platform. What would you like help with?',
};

export function SupportChatbot() {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([welcome]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastQuestion, setLastQuestion] = useState('');
  const sequence = useRef(0);
  const log = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || minimized) return;
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' });
    if (messages.length === 1) field.current?.focus();
  }, [open, minimized, messages, busy]);

  async function ask(question: string) {
    const clean = Array.from(question).map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? ' ' : character;
    }).join('').replace(/\s+/g, ' ').trim();
    if (!clean || busy) return;
    const userMessage: Message = { id: ++sequence.current, role: 'user', text: clean };
    setMessages((current) => [...current.filter((item) => !item.failed), userMessage]);
    setLastQuestion(clean);
    setInput('');
    setBusy(true);
    try {
      const response = await fetch('/api/v1/support/chat', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: clean }),
      });
      const payload = await readBrowserApiPayload<{ answer?: string; links?: SupportLink[] }>(response);
      if (!response.ok) throw new Error(payload.error?.message || 'Support is temporarily unavailable.');
      const answer = payload.data?.answer;
      const links = payload.data?.links;
      if (!answer) throw new Error('Support is temporarily unavailable.');
      setMessages((current) => [...current, {
        id: ++sequence.current,
        role: 'bot',
        text: answer,
        links,
      }]);
    } catch (error) {
      setMessages((current) => [...current, {
        id: ++sequence.current,
        role: 'bot',
        text: error instanceof Error ? error.message : 'Support is temporarily unavailable.',
        failed: true,
      }]);
    } finally {
      setBusy(false);
    }
  }

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(input);
  }

  if (!open) return (
    <button className="support-chat-launcher" onClick={() => setOpen(true)} aria-label="Open SkillOnIT support chat">
      <MessageCircle aria-hidden="true" />
      <span>Help</span>
    </button>
  );

  return (
    <section className={`support-chat${minimized ? ' is-minimized' : ''}`} aria-label="SkillOnIT support chat">
      <header className="support-chat-header">
        <span className="support-chat-avatar"><Bot aria-hidden="true" /></span>
        <span><strong>SkillOnIT Support</strong><small><i /> Platform guidance</small></span>
        <button onClick={() => setMinimized(!minimized)} aria-label={minimized ? 'Expand support chat' : 'Minimize support chat'}><Minus /></button>
        <button onClick={() => setOpen(false)} aria-label="Close support chat"><X /></button>
      </header>
      {!minimized && <>
        <div className="support-chat-log" ref={log} role="log" aria-live="polite" aria-relevant="additions">
          {messages.map((message) => <article key={message.id} className={`support-message ${message.role}${message.failed ? ' failed' : ''}`}>
            <span>{message.text}</span>
            {!!message.links?.length && <nav aria-label="Related SkillOnIT pages">{message.links.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}</nav>}
            {message.failed && <button onClick={() => void ask(lastQuestion)} disabled={busy}><RotateCcw /> Try again</button>}
          </article>)}
          {busy && <output className="support-typing" aria-label="SkillOnIT Support is typing"><i /><i /><i /></output>}
        </div>
        {messages.length === 1 && <div className="support-suggestions" aria-label="Suggested questions">
          {suggestions.map((question) => <button key={question} onClick={() => void ask(question)}>{question}</button>)}
        </div>}
        <form className="support-chat-form" onSubmit={submit}>
          <label className="sr-only" htmlFor="support-question">Ask SkillOnIT Support</label>
          <input ref={field} id="support-question" value={input} onChange={(event) => setInput(event.target.value)} maxLength={500} placeholder="Ask about SkillOnIT…" disabled={busy} autoComplete="off" />
          <button aria-label="Send support question" disabled={busy || !input.trim()}><Send /></button>
        </form>
        <p className="support-chat-note">General platform guidance only. Do not share passwords or sensitive documents.</p>
      </>}
    </section>
  );
}
