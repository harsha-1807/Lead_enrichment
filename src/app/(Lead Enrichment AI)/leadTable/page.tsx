"use client";

import { useEffect, useState, useTransition, useRef } from "react";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.NEXT_PUBLIC_GEMINI_API_KEY!);

type Lead = {
  email: string;
  domain: string;
  chatId: string;
  createdAt: string;
  results: string;
  score?: number;
  reason?: string;
};

const scoreLeadWithGemini = async (lead: Lead): Promise<{ reason: string; score: number }> => {
  const prompt = `
  You are a lead scoring assistant.

  Given the company's data below, assign a numeric score for each of the following criteria. Use this scoring logic:

  🔸 Revenue Score (out of 20)
    • > ₹80Cr or $10M → 20 pts
    • ₹8Cr–₹80Cr or $1M–$10M → 15 pts
    • ₹80L–₹8Cr or $100k–$1M → 10 pts
    • < ₹80L or < $100k → 5 pts
    • No data → 0 pts

  🔸 Employee Size (out of 10)
    • > 200 → 10 pts
    • 51–200 → 7 pts
    • 11–50 → 5 pts
    • ≤ 10 → 2 pts
    • No data → 0 pts

  🔸 Years in Business (out of 10)
    • > 10 years → 10 pts
    • 5–10 years → 7 pts
    • < 5 years → 4 pts
    • No data → 0 pts

  🔸 Funding Score (out of 15)
    • > $5M or ₹40Cr → 15 pts
    • < $5M or ₹40Cr → 10 pts
    • No funding → 0 pts

  🔸 Fortune 500 Presence (out of 10)
    • In list → 10 pts
    • Not in list → 0 pts

  🔸 Fortune 100 Presence (out of 10)
    • In list → 10 pts
    • Not in list → 0 pts

  🔸 Clients / Logos / Big Accounts (out of 15)
    • Enterprise Clients or Well-known Brands → 15 pts
    • Multiple Mid-size Clients → 10 pts
    • Mostly Small Businesses → 5 pts
    • No data → 0 pts

  Add the individual scores and return a total score out of 90.
  Then explain briefly why you gave this score.

  Output ONLY in this format:

  Revenue Score: <x>/20
  Employee Size Score: <x>/10
  Years in Business Score: <x>/10
  Funding Score: <x>/15
  Fortune 500 Score: <x>/10
  Fortune 100 Score: <x>/10
  Clients Score: <x>/15
  Total Score: <x>/90
  Reason: <short explanation>

  Company Data:
  ${lead.results}
  `;

  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  const chat = model.startChat();
  const result = await chat.sendMessage(prompt);
  const text = result.response.text();

  let reason = "N/A",
    score = 0;
  try {
    const scoreMatch = text.match(/Total Score:\s*(\d+(\.\d+)?)/);
    const fullReason = text.match(/Revenue Score:.*(?:\n.*?)+Reason:\s*([\s\S]*)/);
    score = scoreMatch ? parseFloat(scoreMatch[1]) : 0;
    reason = fullReason ? text.trim() : "N/A";
  } catch (err) {
    reason = "Parse failed";
    score = 0;
  }

  return { reason, score };
};

const LeadTablePage = () => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [enriched, setEnriched] = useState(false);
  const [isPending, startTransition] = useTransition();
  const scoredLeadsCache = useRef<Lead[] | null>(null);
  const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

  useEffect(() => {
    const fetchLeads = async () => {
      const res = await fetch(`${BASE_URL}/api/lead`);
      const json = await res.json();
      console.log("Fetched leads from API:", json);
      const data = Array.isArray(json) ? json : Array.isArray(json.data) ? json.data : [];
      console.log("Parsed leads data:", data);
      setLeads(data);
    };
    fetchLeads();
  }, []);

  useEffect(() => {
    if (enriched) {
      if (scoredLeadsCache.current) {
        setLeads(scoredLeadsCache.current);
      } else {
        startTransition(() => {
          Promise.all(
            leads.map(async (lead) => {
              const { reason, score } = await scoreLeadWithGemini(lead);
              return { ...lead, reason, score };
            })
          ).then((scoredLeads) => {
            scoredLeads.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
            scoredLeadsCache.current = scoredLeads;
            setLeads(scoredLeads);
          });
        });
      }
    } else {
      // Toggle OFF — reload original MongoDB data
      const fetchLeads = async () => {
        const res = await fetch("http://localhost:3000/api/lead");
        const json = await res.json();
        const data = Array.isArray(json) ? json : Array.isArray(json.data) ? json.data : [];
        setLeads(data);
      };
      fetchLeads();
    }
  }, [enriched]);

  return (
    <div className="p-10 bg-surface text-on-surface min-h-screen">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Lead Table</h1>
        <label className="flex items-center space-x-2">
          <span className="text-sm">Lead Enrichment</span>
          <input
            type="checkbox"
            checked={enriched}
            onChange={(e) => setEnriched(e.target.checked)}
            className="form-checkbox"
          />
        </label>
      </div>
      <div className="rounded-xl shadow-lg overflow-x-auto max-w-full">
        <table className="w-[1500px] table-auto divide-y divide-surface-variant border border-surface-variant">
          <thead className="bg-surface-variant text-on-surface-variant">
            <tr>
              <th className="px-6 py-4 text-left font-medium text-on-surface uppercase tracking-wide border border-surface-variant rounded-tl-lg">Email</th>
              <th className="px-6 py-4 text-left font-medium text-on-surface uppercase tracking-wide border border-surface-variant">Domain</th>
              <th className="px-6 py-4 text-left font-medium text-on-surface uppercase tracking-wide border border-surface-variant">Created At</th>
              <th className="px-6 py-4 text-left font-medium text-on-surface uppercase tracking-wide border border-surface-variant align-top w-[700px] max-w-[700px]">Results</th>
              <th className="px-6 py-4 text-left font-medium text-on-surface uppercase tracking-wide border border-surface-variant">Score</th>
              <th className="px-6 py-4 text-left font-medium text-on-surface uppercase tracking-wide border border-surface-variant w-[300px] align-top rounded-tr-lg max-w-[300px]">Reason</th>
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center px-6 py-4 text-sm text-on-surface">No leads found.</td>
              </tr>
            ) : (
              leads.map((lead, idx) => (
                <tr key={idx} className={idx % 2 === 0 ? 'bg-surface' : 'bg-surface-variant'}>
                  <td className="px-6 py-4 text-sm text-on-surface align-middle whitespace-nowrap border border-surface-variant rounded-l-lg">{lead.email}</td>
                  <td className="px-6 py-4 text-sm text-on-surface align-middle whitespace-nowrap border border-surface-variant">{lead.domain}</td>
                  <td className="px-6 py-4 text-sm text-on-surface align-middle whitespace-nowrap border border-surface-variant">{lead.createdAt}</td>
                  <td className="px-6 py-4 text-sm leading-snug text-on-surface align-top border border-surface-variant whitespace-pre-wrap w-[700px] max-w-[700px]">{(() => {
                    let parsedResults;
                    try {
                      parsedResults = JSON.parse(lead.results);
                    } catch {
                      parsedResults = null;
                    }
                    if (Array.isArray(parsedResults)) {
                      return parsedResults.map((item: any, idx: number) => (
                        <div key={idx} className="rounded-lg shadow-md p-2 bg-surface-variant space-y-1 whitespace-normal leading-tight">
                          <div>
                            <p className="text-sm leading-snug text-on-surface"><strong>Q:</strong> {item.question}</p>
                            <p className="text-sm leading-snug text-on-surface"><strong>A:</strong> {item.answer}</p>
                          </div>
                        </div>
                      ));
                    } else {
                      return <p className="text-on-surface">{lead.results}</p>;
                    }
                  })()}</td>
                  <td className="px-6 py-4 text-sm text-on-surface text-center align-middle border border-surface-variant">{lead.score ?? '-'}</td>
                  <td className="px-6 py-4 text-sm text-on-surface align-top border border-surface-variant whitespace-pre-wrap w-[300px] rounded-r-lg">{lead.reason ?? '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default LeadTablePage;