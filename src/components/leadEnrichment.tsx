

'use client';

import { useState } from 'react';
import { toast } from 'sonner';

interface Props {
  onSubmit: (email: string, company: string) => void;
}

const LeadEnrichment = ({ onSubmit }: Props) => {
  const [email, setEmail] = useState('');

  const handleSubmit = () => {
    if (!email.includes('@')) {
      toast.error('Please enter a valid email address');
      return;
    }

    const domain = email.split('@')[1];
    const company = domain.split('.')[0];
    toast.success(`Company extracted: ${company}`);
    onSubmit(email, company);
  };

  return (
    <div className="p-10 flex flex-col items-start gap-4">
      <h2 className="text-xl font-semibold text-white">Lead Enrichment</h2>
      <input
        type="text"
        placeholder="Enter lead email (e.g., john@company.com)"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="border px-3 py-2 rounded w-96 dark:bg-[#111] dark:text-white"
      />
      <button
        onClick={handleSubmit}
        className="ml-0 mt-2 bg-blue-600 text-white px-4 py-2 rounded"
      >
        Enrich Lead
      </button>
    </div>
  );
};

export default LeadEnrichment;