import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageSquare, X, Send, Loader2 } from 'lucide-react';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api';
import type { ChatbotResponse, PredefinedQuestion } from '@admin/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  response?: ChatbotResponse;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PREDEFINED_QUESTIONS: PredefinedQuestion[] = [
  // Sales
  { category: 'sales', question: 'What were total sales yesterday?' },
  { category: 'sales', question: 'Which store had the highest revenue this week?' },
  { category: 'sales', question: 'Show me the top 5 selling products this month' },
  // Inventory
  { category: 'inventory', question: 'Which products are out of stock?' },
  { category: 'inventory', question: 'Show products with less than 5 units' },
  { category: 'inventory', question: "What's the aging inventory over 90 days?" },
  // Operations
  { category: 'operations', question: 'How many orders are pending processing?' },
  { category: 'operations', question: "What's the average time to ship?" },
];

const CATEGORY_LABELS: Record<PredefinedQuestion['category'], string> = {
  sales: 'Sales',
  inventory: 'Inventory',
  operations: 'Operations',
};

const CATEGORY_VARIANT: Record<PredefinedQuestion['category'], 'default' | 'secondary' | 'outline'> = {
  sales: 'default',
  inventory: 'secondary',
  operations: 'outline',
};

const currencyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Determines if a cell value looks like a currency amount and formats it.
 * Matches values containing the pound sign or numeric values above 100
 * (heuristic for revenue / monetary fields).
 */
function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '-';
  const str = String(value);

  // Already contains a pound sign - try to parse the numeric portion
  if (str.includes('\u00a3') || str.includes('£')) {
    const numeric = parseFloat(str.replace(/[^0-9.\-]/g, ''));
    if (!isNaN(numeric)) return currencyFormatter.format(numeric);
    return str;
  }

  // Pure numeric value > 100 - treat as currency (common for revenue fields)
  if (typeof value === 'number' && value > 100) {
    return currencyFormatter.format(value);
  }

  return str;
}

function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status === 429) return 'Rate limit exceeded. Please wait before asking another question.';
    if (status === 503) return 'AI chatbot is not available.';
  }
  return 'Something went wrong. Please try again.';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function QuestionChips({
  onSelect,
  disabled,
}: {
  onSelect: (question: string) => void;
  disabled: boolean;
}) {
  const categories = Object.keys(CATEGORY_LABELS) as PredefinedQuestion['category'][];

  return (
    <div className="space-y-3 px-4 py-3 border-b">
      {categories.map((category) => (
        <div key={category}>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
            {CATEGORY_LABELS[category]}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {PREDEFINED_QUESTIONS.filter((q) => q.category === category).map((q) => (
              <Badge
                key={q.question}
                variant={CATEGORY_VARIANT[category]}
                className="cursor-pointer text-xs font-normal hover:opacity-80 transition-opacity"
                onClick={() => !disabled && onSelect(q.question)}
              >
                {q.question}
              </Badge>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ResultsTable({ results }: { results: Record<string, unknown>[] }) {
  if (results.length === 0) return null;
  const columns = Object.keys(results[0]);

  return (
    <div className="mt-2 max-h-60 overflow-auto rounded border">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col} className="text-xs whitespace-nowrap">
                {col}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.map((row, idx) => (
            <TableRow key={idx}>
              {columns.map((col) => (
                <TableCell key={col} className="text-xs py-1.5 whitespace-nowrap">
                  {formatCellValue(row[col])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[85%] rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.role === 'error') {
    return (
      <div className="flex justify-start mb-3">
        <div className="max-w-[85%] rounded-lg bg-destructive/10 text-destructive border border-destructive/20 px-3 py-2 text-sm">
          {message.content}
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="flex justify-start mb-3">
      <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm space-y-1">
        <p className="whitespace-pre-wrap">{message.content}</p>
        {message.response && message.response.results.length > 0 && (
          <ResultsTable results={message.response.results} />
        )}
        {message.response && (
          <p className="text-xs text-muted-foreground mt-1">
            {message.response.resultCount} result{message.response.resultCount !== 1 ? 's' : ''} in{' '}
            {message.response.executionTimeMs}ms
          </p>
        )}
      </div>
    </div>
  );
}

function LoadingBubble() {
  return (
    <div className="flex justify-start mb-3">
      <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Analyzing your question...
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function ChatbotPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const scrollEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Focus textarea when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const sendQuestion = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || isLoading) return;

      // Add user message
      const userMsg: ChatMessage = {
        id: generateId(),
        role: 'user',
        content: trimmed,
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      setIsLoading(true);

      try {
        const { data } = await api.post<{ data: ChatbotResponse }>(
          '/sales-dashboard/chatbot/query',
          { question: trimmed }
        );

        const assistantMsg: ChatMessage = {
          id: generateId(),
          role: 'assistant',
          content: data.data.summary,
          response: data.data,
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } catch (error: unknown) {
        const errorMsg: ChatMessage = {
          id: generateId(),
          role: 'error',
          content: getErrorMessage(error),
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Shift+Enter inserts a newline (default behaviour), Enter alone sends
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendQuestion(input);
      }
    },
    [input, sendQuestion]
  );

  const handleChipSelect = useCallback(
    (question: string) => {
      sendQuestion(question);
    },
    [sendQuestion]
  );

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <>
      {/* Floating toggle button */}
      {!isOpen && (
        <Button
          size="icon"
          className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-lg"
          onClick={() => setIsOpen(true)}
          aria-label="Open Sales AI Assistant"
        >
          <MessageSquare className="h-6 w-6" />
        </Button>
      )}

      {/* Chat panel */}
      {isOpen && (
        <div className="fixed bottom-0 right-0 z-50 flex h-[calc(100vh-2rem)] w-[400px] flex-col rounded-tl-lg border bg-background shadow-2xl m-4 mb-0 mr-0 rounded-tr-none rounded-br-none">
          {/* Header */}
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              <h2 className="text-sm font-semibold">Sales AI Assistant</h2>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setIsOpen(false)}
              aria-label="Close Sales AI Assistant"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Predefined questions */}
          <QuestionChips onSelect={handleChipSelect} disabled={isLoading} />

          {/* Messages area */}
          <ScrollArea className="flex-1 px-4 py-3">
            {messages.length === 0 && !isLoading && (
              <p className="text-center text-sm text-muted-foreground py-8">
                Ask a question about your sales data, inventory, or operations.
              </p>
            )}
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {isLoading && <LoadingBubble />}
            <div ref={scrollEndRef} />
          </ScrollArea>

          {/* Input area */}
          <div className="border-t px-4 py-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about sales, inventory, orders..."
                rows={1}
                className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 max-h-24 overflow-y-auto"
                disabled={isLoading}
              />
              <Button
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => sendQuestion(input)}
                disabled={!input.trim() || isLoading}
                aria-label="Send message"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Press Enter to send, Shift+Enter for new line
            </p>
          </div>
        </div>
      )}
    </>
  );
}
