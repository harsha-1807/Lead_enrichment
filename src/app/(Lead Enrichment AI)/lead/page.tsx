'use client';

import { useEffect, useRef, useState } from 'react';
import { Document } from '@langchain/core/documents';
import Navbar from '@/components/Navbar';
import Chat from '@/components/Chat';
import EmptyChat from '@/components/EmptyChat';
import crypto from 'crypto';
import { toast } from 'sonner';
import { useSearchParams } from 'next/navigation';
import { getSuggestions } from '@/lib/actions';
import { Settings } from 'lucide-react';
import Link from 'next/link';
import NextError from 'next/error';

export type Message = {
  messageId: string;
  chatId: string;
  createdAt: Date;
  content: string;
  role: 'user' | 'assistant';
  suggestions?: string[];
  sources?: Document[];
};

export interface File {
  fileName: string;
  fileExtension: string;
  fileId: string;
}

interface ChatModelProvider {
  name: string;
  provider: string;
}

interface EmbeddingModelProvider {
  name: string;
  provider: string;
}

// Function to check and configure chat and embedding model settings
const checkConfig = async (
  setChatModelProvider: (provider: ChatModelProvider) => void,
  setEmbeddingModelProvider: (provider: EmbeddingModelProvider) => void,
  setIsConfigReady: (ready: boolean) => void,
  setHasError: (hasError: boolean) => void,
) => {
  try {
    // Retrieve model settings from local storage
    let chatModel = localStorage.getItem('chatModel');
    let chatModelProvider = localStorage.getItem('chatModelProvider');
    let embeddingModel = localStorage.getItem('embeddingModel');
    let embeddingModelProvider = localStorage.getItem('embeddingModelProvider');

    // Retrieve auto search settings from local storage
    const autoImageSearch = localStorage.getItem('autoImageSearch');
    const autoVideoSearch = localStorage.getItem('autoVideoSearch');

    // Set default values for auto search settings if not present
    if (!autoImageSearch) {
      localStorage.setItem('autoImageSearch', 'true');
    }

    if (!autoVideoSearch) {
      localStorage.setItem('autoVideoSearch', 'false');
    }

    // Fetch available model providers from the server
    const providers = await fetch(`/api/models`, {
      headers: {
        'Content-Type': 'application/json',
      },
    }).then(async (res) => {
      if (!res.ok)
        throw new Error(
          `Failed to fetch models: ${res.status} ${res.statusText}`,
        );
      return res.json();
    });

    // Check if any model settings are missing
    if (
      !chatModel ||
      !chatModelProvider ||
      !embeddingModel ||
      !embeddingModelProvider
    ) {
      // Handle missing chat model settings
      if (!chatModel || !chatModelProvider) {
        const chatModelProviders = providers.chatModelProviders;
        const chatModelProvidersKeys = Object.keys(chatModelProviders);

        if (!chatModelProviders || chatModelProvidersKeys.length === 0) {
          return toast.error('No chat models available');
        } else {
          chatModelProvider =
            chatModelProvidersKeys.find(
              (provider) =>
                Object.keys(chatModelProviders[provider]).length > 0,
            ) || chatModelProvidersKeys[0];
        }

        if (
          chatModelProvider === 'custom_openai' &&
          Object.keys(chatModelProviders[chatModelProvider]).length === 0
        ) {
          toast.error(
            "Looks like you haven't configured any chat model providers. Please configure them from the settings page or the config file.",
          );
          return setHasError(true);
        }

        chatModel = Object.keys(chatModelProviders[chatModelProvider])[0];
      }

      // Handle missing embedding model settings
      if (!embeddingModel || !embeddingModelProvider) {
        const embeddingModelProviders = providers.embeddingModelProviders;

        if (
          !embeddingModelProviders ||
          Object.keys(embeddingModelProviders).length === 0
        )
          return toast.error('No embedding models available');

        embeddingModelProvider = Object.keys(embeddingModelProviders)[0];
        embeddingModel = Object.keys(
          embeddingModelProviders[embeddingModelProvider],
        )[0];
      }

      // Save model settings to local storage
      localStorage.setItem('chatModel', chatModel!);
      localStorage.setItem('chatModelProvider', chatModelProvider);
      localStorage.setItem('embeddingModel', embeddingModel!);
      localStorage.setItem('embeddingModelProvider', embeddingModelProvider);
    } else {
      // Validate existing model settings
      const chatModelProviders = providers.chatModelProviders;
      const embeddingModelProviders = providers.embeddingModelProviders;

      if (
        Object.keys(chatModelProviders).length > 0 &&
        (!chatModelProviders[chatModelProvider] ||
          Object.keys(chatModelProviders[chatModelProvider]).length === 0)
      ) {
        const chatModelProvidersKeys = Object.keys(chatModelProviders);
        chatModelProvider =
          chatModelProvidersKeys.find(
            (key) => Object.keys(chatModelProviders[key]).length > 0,
          ) || chatModelProvidersKeys[0];

        localStorage.setItem('chatModelProvider', chatModelProvider);
      }

      if (
        chatModelProvider &&
        !chatModelProviders[chatModelProvider][chatModel]
      ) {
        if (
          chatModelProvider === 'custom_openai' &&
          Object.keys(chatModelProviders[chatModelProvider]).length === 0
        ) {
          toast.error(
            "Looks like you haven't configured any chat model providers. Please configure them from the settings page or the config file.",
          );
          return setHasError(true);
        }

        chatModel = Object.keys(
          chatModelProviders[
            Object.keys(chatModelProviders[chatModelProvider]).length > 0
              ? chatModelProvider
              : Object.keys(chatModelProviders)[0]
          ],
        )[0];

        localStorage.setItem('chatModel', chatModel);
      }

      if (
        Object.keys(embeddingModelProviders).length > 0 &&
        !embeddingModelProviders[embeddingModelProvider]
      ) {
        embeddingModelProvider = Object.keys(embeddingModelProviders)[0];
        localStorage.setItem('embeddingModelProvider', embeddingModelProvider);
      }

      if (
        embeddingModelProvider &&
        !embeddingModelProviders[embeddingModelProvider][embeddingModel]
      ) {
        embeddingModel = Object.keys(
          embeddingModelProviders[embeddingModelProvider],
        )[0];
        localStorage.setItem('embeddingModel', embeddingModel);
      }
    }

    // Update state with configured model providers
    setChatModelProvider({
      name: chatModel!,
      provider: chatModelProvider,
    });

    setEmbeddingModelProvider({
      name: embeddingModel!,
      provider: embeddingModelProvider,
    });

    // Indicate that configuration is ready
    setIsConfigReady(true);
  } catch (err) {
    console.error('An error occurred while checking the configuration:', err);
    setIsConfigReady(false);
    setHasError(true);
  }
};

// Function to load messages for a given chat ID
const loadMessages = async (
  chatId: string,
  setMessages: (messages: Message[]) => void,
  setIsMessagesLoaded: (loaded: boolean) => void,
  setChatHistory: (history: [string, string][]) => void,
  setFocusMode: (mode: string) => void,
  setNotFound: (notFound: boolean) => void,
  setFiles: (files: File[]) => void,
  setFileIds: (fileIds: string[]) => void,
) => {
  // Fetch chat data from the server
  const res = await fetch(`/api/chats/${chatId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // Handle case where chat is not found
  if (res.status === 404) {
    setNotFound(true);
    setIsMessagesLoaded(true);
    return;
  }

  // Parse response data
  const data = await res.json();

  // Map messages to include metadata
  const messages = data.messages.map((msg: any) => {
    return {
      ...msg,
      ...JSON.parse(msg.metadata),
    };
  }) as Message[];

  // Update state with loaded messages
  setMessages(messages);

  // Create chat history from messages
  const history = messages.map((msg) => {
    return [msg.role, msg.content];
  }) as [string, string][];

  console.debug(new Date(), 'app:messages_loaded');

  // Set document title to the first message content
  document.title = messages[0].content;

  // Map files from chat data
  const files = data.chat.files.map((file: any) => {
    return {
      fileName: file.name,
      fileExtension: file.name.split('.').pop(),
      fileId: file.fileId,
    };
  });

  // Update state with files and file IDs
  setFiles(files);
  setFileIds(files.map((file: File) => file.fileId));

  // Update chat history and focus mode
  setChatHistory(history);
  setFocusMode(data.chat.focusMode);
  setIsMessagesLoaded(true);
};

interface LeadPageProps {
  params: { id?: string };
}

// Lead component for handling lead enrichment
const Lead = ({ params }: LeadPageProps) => {
  const { id } = params;
  // State for lead enrichment email and domain
  const [leadEnrichmentEmail, setLeadEnrichmentEmail] = useState('');
  const [leadEnrichmentDomain, setLeadEnrichmentDomain] = useState('');
  // State for enriched leads results
  const [leadEnrichmentResults, setLeadEnrichmentResults] = useState<{ question: string; answer: string }[]>([]);
  // Ref to hold latest enrichment results for async handlers
  const leadEnrichmentResultsRef = useRef<{ question: string; answer: string }[]>([]);
  // Handler for lead enrichment process
  const handleLeadEnrichment = async () => {
    // Split and validate email addresses
    const emails = leadEnrichmentEmail
      .split(',')
      .map(e => e.trim())
      .filter(e => e.includes('@'));

    if (emails.length === 0) {
      toast.error('Please enter at least one valid email');
      return;
    }

    // Process each email for enrichment
    const extractCompanyInfo = (email: string) => {
      const domain = email.split('@')[1];
      const companyName = domain.split('.')[0];

      return {
        companyName,
        fullDomain: domain,
        searchQuery: `"${companyName}" site:${domain} OR "${companyName}" company`,
        fallbackQuery: `"${companyName}.${domain.split('.').pop()}" company information`
      };
    };

    for (const email of emails) {
      const { companyName: company, fullDomain, searchQuery, fallbackQuery } = extractCompanyInfo(email);

      // Generate a new chat ID for the enrichment process
      const newChatId = crypto.randomBytes(20).toString('hex');
      setChatId(newChatId);
      setMessages([]);
      setChatHistory([]);
      setLeadEnrichmentDomain(company);
      setLeadEnrichmentResults([]);

      toast.success(`Started enrichment for: ${company}`);

      // Define enrichment questions
      const enrichmentQuestions = [
        `What does ${fullDomain} company do? Please give a short description in two lines.`,
        `What is the website of the company with the domain ${fullDomain}?`,
        `What are the revenue figures for the company with the domain ${fullDomain}? Only include results related to this entity and list each figure along with the source name.`,
        `What is the employee size of ${company} company? Please reply with only the number of employees in two short sentences, without additional explanation.`,
        `How many years has ${company} company been in business? Please reply with only the number of years in two short sentences, without additional explanation.`,
        `What is the latest funding news for ${company} company? Please reply with only the latest funding amount and date in two short sentences in bullet points, without additional explanation.`,
        `Is ${company} in the Fortune 500 list? Please respond with a yes or no and one short supporting detail.`,
        `Is ${company} in the Fortune 100 list? Please respond with a yes or no and one short supporting detail.`,
        `Who are the clients of ${company}? List major clients or industries they serve.`,
        `What is the industry classification of ${company}?`,
        `What is the LinkedIn profile link of the company named ${company}? Return only the link.`,
      ];

      // Send each enrichment question as a message
      for (const q of enrichmentQuestions) {
        await sendMessage(q, undefined, false, newChatId);
        await new Promise((resolve) => setTimeout(resolve, 4000));
      }

      // Wait for chat to settle before processing the next email
      await new Promise((r) => setTimeout(r, 1500));

      // Save enrichment results to the server
      let extractedResults: { question: string; answer: string }[] = [];
      extractedResults = leadEnrichmentResultsRef.current;
      console.log("Extracted Results before POST:", extractedResults);
      if (!extractedResults || extractedResults.length === 0) {
        toast.error('No enrichment results to save for this lead.');
        continue;
      }
      try {
        console.log('Sending to /api/lead', {
          email,
          company,
          chatId: newChatId,
          results: extractedResults
        });
        const response = await fetch('/api/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            company, // this is the companyName for collection
            chatId: newChatId,
            results: extractedResults,
          }),
        });
        const responseText = await response.clone().text();
        console.log('Raw response from /api/lead:', responseText);

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Unknown error occurred');
        }

        toast.success('Lead enrichment saved successfully');
      } catch (err) {
        console.error('Error saving lead enrichment:', err);
        toast.error('Failed to save lead enrichment to database');
      }

      // Delay before processing the next email
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  };

  // Sync leadEnrichmentResultsRef with the latest state
  useEffect(() => {
    leadEnrichmentResultsRef.current = leadEnrichmentResults;
  }, [leadEnrichmentResults]);

  // Retrieve search parameters from the URL
  const searchParams = useSearchParams();
  const initialMessage = searchParams.get('q');

  // State for chat ID and chat creation status
  const [chatId, setChatId] = useState<string | undefined>(id);
  const [newChatCreated, setNewChatCreated] = useState(false);

  // State for chat and embedding model providers
  const [chatModelProvider, setChatModelProvider] = useState<ChatModelProvider>(
    {
      name: '',
      provider: '',
    },
  );

  const [embeddingModelProvider, setEmbeddingModelProvider] =
    useState<EmbeddingModelProvider>({
      name: '',
      provider: '',
    });

  // State for configuration readiness and error status
  const [isConfigReady, setIsConfigReady] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isReady, setIsReady] = useState(false);

  // Effect to check configuration on component mount
  useEffect(() => {
    checkConfig(
      setChatModelProvider,
      setEmbeddingModelProvider,
      setIsConfigReady,
      setHasError,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // State for loading status and message appearance
  const [loading, setLoading] = useState(false);
  const [messageAppeared, setMessageAppeared] = useState(false);

  // State for chat history and messages
  const [chatHistory, setChatHistory] = useState<[string, string][]>([]);
  const [messages, setMessages] = useState<Message[]>([]);

  // State for files and file IDs
  const [files, setFiles] = useState<File[]>([]);
  const [fileIds, setFileIds] = useState<string[]>([]);

  // State for focus and optimization modes
  const [focusMode, setFocusMode] = useState('webSearch');
  const [optimizationMode, setOptimizationMode] = useState('speed');

  // State for message loading status and not found status
  const [isMessagesLoaded, setIsMessagesLoaded] = useState(false);
  const [notFound, setNotFound] = useState(false);

  // Effect to load messages if chat ID is present
  useEffect(() => {
    if (
      chatId &&
      !newChatCreated &&
      !isMessagesLoaded &&
      messages.length === 0
    ) {
      loadMessages(
        chatId,
        setMessages,
        setIsMessagesLoaded,
        setChatHistory,
        setFocusMode,
        setNotFound,
        setFiles,
        setFileIds,
      );
    } else if (!chatId) {
      setNewChatCreated(true);
      setIsMessagesLoaded(true);
      setChatId(crypto.randomBytes(20).toString('hex'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ref to hold the current messages
  const messagesRef = useRef<Message[]>([]);

  // Effect to sync messagesRef with the latest messages
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Effect to set readiness status based on message and config loading
  useEffect(() => {
    if (isMessagesLoaded && isConfigReady) {
      setIsReady(true);
      console.debug(new Date(), 'app:ready');
    } else {
      setIsReady(false);
    }
  }, [isMessagesLoaded, isConfigReady]);

  // Function to send a message
  const sendMessage = async (
    message: string,
    messageId?: string,
    rewrite = false,
    overrideChatId?: string,
  ) => {
    if (loading) return;
    if (!isConfigReady) {
      toast.error('Cannot send message before the configuration is ready');
      return;
    }

    setLoading(true);
    setMessageAppeared(false);

    let sources: Document[] | undefined = undefined;
    let recievedMessage = '';
    let added = false;

    messageId = messageId ?? crypto.randomBytes(7).toString('hex');

    // Add user message to the state
    setMessages((prevMessages) => [
      ...prevMessages,
      {
        content: message,
        messageId: messageId,
        chatId: overrideChatId ?? chatId!,
        role: 'user',
        createdAt: new Date(),
      },
    ]);

    // Handler for processing incoming message data
    const messageHandler = async (data: any) => {
      if (data.type === 'error') {
        toast.error(data.data);
        setLoading(false);
        return;
      }

      if (data.type === 'sources') {
        sources = data.data;
        if (!added) {
          setMessages((prevMessages) => [
            ...prevMessages,
            {
              content: '',
              messageId: data.messageId,
              chatId: overrideChatId ?? chatId!,
              role: 'assistant',
              sources: sources,
              createdAt: new Date(),
            },
          ]);
          added = true;
        }
        setMessageAppeared(true);
      }

      if (data.type === 'message') {
        if (!added) {
          setMessages((prevMessages) => [
            ...prevMessages,
            {
              content: data.data,
              messageId: data.messageId,
              chatId: overrideChatId ?? chatId!,
              role: 'assistant',
              sources: sources,
              createdAt: new Date(),
            },
          ]);
          added = true;
        }

        // Update message content with new data
        setMessages((prev) =>
          prev.map((message) => {
            if (message.messageId === data.messageId) {
              return { ...message, content: message.content + data.data };
            }

            return message;
          }),
        );

        recievedMessage += data.data;
        setMessageAppeared(true);
      }

      if (data.type === 'messageEnd') {
        // Update chat history with the completed message
        setChatHistory((prevHistory) => [
          ...prevHistory,
          ['human', message],
          ['assistant', recievedMessage],
        ]);

        // Save all enrichment prompt responses
        // Updated enrichment questions for matching
        const enrichmentQuestions = [
          `What does ${leadEnrichmentDomain} company do? Please give a short description in two lines.`,
          `What is the website of the company with the domain ${leadEnrichmentDomain}?`,
          `What are the revenue figures for the company with the domain ${leadEnrichmentDomain}? Only include results related to this entity and list each figure along with the source name.`,
          `What is the employee size of ${leadEnrichmentDomain} company? Please reply with only the number of employees in two short sentences, without additional explanation.`,
          `How many years has ${leadEnrichmentDomain} company been in business? Please reply with only the number of years in two short sentences, without additional explanation.`,
          `What is the latest funding news for ${leadEnrichmentDomain} company? Please reply with only the latest funding amount and date in two short sentences in bullet points, without additional explanation.`,
          `Is ${leadEnrichmentDomain} in the Fortune 500 list? Please respond with a yes or no and one short supporting detail.`,
          `Is ${leadEnrichmentDomain} in the Fortune 100 list? Please respond with a yes or no and one short supporting detail.`,
          `Who are the clients of ${leadEnrichmentDomain}? List major clients or industries they serve.`,
          `What is the industry classification of ${leadEnrichmentDomain}?`,
          `What is the LinkedIn profile link of the company named ${leadEnrichmentDomain}? Return only the link.`,
        ];

        // Check if message is one of the enrichment questions
        // Use more flexible check: partial match by first word of enrichment question
        if (
          enrichmentQuestions.some(q =>
            message.toLowerCase().includes(q.split(' ')[0].toLowerCase())
          )
        ) {
          const answer = recievedMessage.trim();
          const entry = { question: message, answer };
          setLeadEnrichmentResults(prev => {
            const updated = [...prev];
            const idx = updated.findIndex(item => item.question === message);
            if (idx > -1) updated[idx] = entry;
            else updated.push(entry);
            return updated;
          });
        }

        setLoading(false);

        const lastMsg = messagesRef.current[messagesRef.current.length - 1];

        const autoImageSearch = localStorage.getItem('autoImageSearch');
        const autoVideoSearch = localStorage.getItem('autoVideoSearch');

        // Trigger auto image search if enabled
        if (autoImageSearch === 'true') {
          document
            .getElementById(`search-images-${lastMsg.messageId}`)
            ?.click();
        }

        // Trigger auto video search if enabled
        if (autoVideoSearch === 'true') {
          document
            .getElementById(`search-videos-${lastMsg.messageId}`)
            ?.click();
        }

        // Fetch suggestions if the last message has sources
        if (
          lastMsg.role === 'assistant' &&
          lastMsg.sources &&
          lastMsg.sources.length > 0 &&
          !lastMsg.suggestions
        ) {
          const suggestions = await getSuggestions(messagesRef.current);
          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.messageId === lastMsg.messageId) {
                return { ...msg, suggestions: suggestions };
              }
              return msg;
            }),
          );
        }
      }
    };

    // Find the index of the message to be rewritten
    const messageIndex = messages.findIndex((m) => m.messageId === messageId);

    // Send the message to the server
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: message,
        message: {
          messageId: messageId,
          chatId: overrideChatId ?? chatId!,
          content: message,
        },
        chatId: overrideChatId ?? chatId!,
        files: fileIds,
        focusMode: focusMode,
        optimizationMode: optimizationMode,
        history: rewrite
          ? chatHistory.slice(0, messageIndex === -1 ? undefined : messageIndex)
          : chatHistory,
        chatModel: {
          name: chatModelProvider.name,
          provider: chatModelProvider.provider,
        },
        embeddingModel: {
          name: embeddingModelProvider.name,
          provider: embeddingModelProvider.provider,
        },
        systemInstructions: localStorage.getItem('systemInstructions'),
      }),
    });

    if (!res.body) throw new Error('No response body');

    const reader = res.body?.getReader();
    const decoder = new TextDecoder('utf-8');

    let partialChunk = '';

    // Read and process the response stream
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      partialChunk += decoder.decode(value, { stream: true });

      try {
        const messages = partialChunk.split('\n');
        for (const msg of messages) {
          if (!msg.trim()) continue;
          const json = JSON.parse(msg);
          messageHandler(json);
        }
        partialChunk = '';
      } catch (error) {
        console.warn('Incomplete JSON, waiting for next chunk...');
      }
    }
  };

  // Function to rewrite a message
  const rewrite = (messageId: string) => {
    const index = messages.findIndex((msg) => msg.messageId === messageId);

    if (index === -1) return;

    const message = messages[index - 1];

    // Remove messages and chat history up to the message to be rewritten
    setMessages((prev) => {
      return [...prev.slice(0, messages.length > 2 ? index - 1 : 0)];
    });
    setChatHistory((prev) => {
      return [...prev.slice(0, messages.length > 2 ? index - 1 : 0)];
    });

    // Send the message again for rewriting
    sendMessage(message.content, message.messageId, true);
  };

  // Effect to send the initial message if ready
  useEffect(() => {
    if (isReady && initialMessage && isConfigReady) {
      sendMessage(initialMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfigReady, isReady, initialMessage]);

  // Render error message if there is a connection error
  if (hasError) {
    return (
      <div className="relative">
        <div className="absolute w-full flex flex-row items-center justify-end mr-5 mt-5">
          <Link href="/settings">
            <Settings className="cursor-pointer lg:hidden" />
          </Link>
        </div>
        <div className="flex flex-col items-center justify-center min-h-screen">
          <p className="dark:text-white/70 text-black/70 text-sm">
            Failed to connect to the server. Please try again later.
          </p>
        </div>
      </div>
    );
  }

  // Render the main UI if ready
  return isReady ? (
    notFound ? (
      <NextError statusCode={404} />
    ) : (
      <div>
        {/* Lead Enrichment UI */}
        <div className="relative">
          <div className="flex flex-col items-center justify-center max-w-screen-sm mx-auto p-2 space-y-4 pt-24">
            <div className="flex flex-col items-center justify-center w-full space-y-8">
              <div className="flex flex-col items-center space-y-4 -mt-16">
                <img src="/asset/BlackBg.png" alt="Briha Logo" className="w-40 h-40 object-contain" />
                <h2 className="text-4xl font-medium text-black/70 dark:text-white/70 tracking-tight text-center">
                  Briha - Lead Enrichment.
                </h2>
              </div>
              <div className="flex flex-col sm:flex-row items-center justify-center w-full gap-3">
                <input
                  type="text"
                  placeholder="Enter lead email (e.g., john@company.com)"
                  value={leadEnrichmentEmail}
                  onChange={(e) => setLeadEnrichmentEmail(e.target.value)}
                  className="bg-[#111] text-white placeholder:text-gray-400 border border-gray-600 rounded-lg px-4 py-3 w-full sm:w-96 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={handleLeadEnrichment}
                  className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-lg text-sm font-medium transition-all"
                >
                  Enrich Lead
                </button>
              </div>
              {leadEnrichmentDomain && (
                <span className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                  Extracted company: {leadEnrichmentDomain}
                </span>
              )}
            </div>
          </div>
        </div>
        {/* End Lead Enrichment UI */}
        {/* Enriched Leads Table */}
        {leadEnrichmentResults.length > 0 && (
          <div className="p-4 mt-4 bg-gray-100 dark:bg-[#111] rounded-md">
            <h3 className="font-semibold mb-2 dark:text-white">Extracted Lead Summary</h3>
            <table className="table-auto text-sm w-full dark:text-white">
              <thead>
                <tr className="text-left border-b border-gray-300 dark:border-gray-700">
                  <th className="p-2">Question</th>
                  <th className="p-2">Answer</th>
                </tr>
              </thead>
              <tbody>
                {leadEnrichmentResults.map((item, i) => (
                  <tr key={i} className="border-t border-gray-200 dark:border-gray-800">
                    <td className="p-2">{item.question}</td>
                    <td className="p-2">{item.answer}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {/* End Enriched Leads Table */}
        {messages.length > 0 ? (
          <>
            <Navbar chatId={chatId!} messages={messages} />
            <Chat
              loading={loading}
              messages={messages}
              sendMessage={sendMessage}
              messageAppeared={messageAppeared}
              rewrite={rewrite}
              fileIds={fileIds}
              setFileIds={setFileIds}
              files={files}
              setFiles={setFiles}
            />
          </>
        ) : (
          <div className="flex flex-col items-center justify-center mt-32 text-center text-gray-500 dark:text-gray-300">
            {/* <h2 className="text-2xl font-semibold mb-2">Lead Enrichment</h2>
            <p className="text-sm max-w-md">
              Start enriching leads by entering their email address above. You’ll get company insights like revenue, employee count, CEO, and more.
            </p> */}
          </div>
        )}
      </div>
    )
  ) : (
    <div className="flex flex-row items-center justify-center min-h-screen">
      <svg
        aria-hidden="true"
        className="w-8 h-8 text-light-200 fill-light-secondary dark:text-[#202020] animate-spin dark:fill-[#ffffff3b]"
        viewBox="0 0 100 101"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M100 50.5908C100.003 78.2051 78.1951 100.003 50.5908 100C22.9765 99.9972 0.997224 78.018 1 50.4037C1.00281 22.7993 22.8108 0.997224 50.4251 1C78.0395 1.00281 100.018 22.8108 100 50.4251ZM9.08164 50.594C9.06312 73.3997 27.7909 92.1272 50.5966 92.1457C73.4023 92.1642 92.1298 73.4365 92.1483 50.6308C92.1669 27.8251 73.4392 9.0973 50.6335 9.07878C27.8278 9.06026 9.10003 27.787 9.08164 50.594Z"
          fill="currentColor"
        />
        <path
          d="M93.9676 39.0409C96.393 38.4037 97.8624 35.9116 96.9801 33.5533C95.1945 28.8227 92.871 24.3692 90.0681 20.348C85.6237 14.1775 79.4473 9.36872 72.0454 6.45794C64.6435 3.54717 56.3134 2.65431 48.3133 3.89319C45.869 4.27179 44.3768 6.77534 45.014 9.20079C45.6512 11.6262 48.1343 13.0956 50.5786 12.717C56.5073 11.8281 62.5542 12.5399 68.0406 14.7911C73.527 17.0422 78.2187 20.7487 81.5841 25.4923C83.7976 28.5886 85.4467 32.059 86.4416 35.7474C87.1273 38.1189 89.5423 39.6781 91.9676 39.0409Z"
          fill="currentFill"
        />
      </svg>
    </div>
  );
};

export default Lead;
