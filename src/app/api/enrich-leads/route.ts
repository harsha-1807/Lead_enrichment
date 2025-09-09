// Runtime & caching hints for Next.js App Router
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0; // do not cache
export const maxDuration = 60; // seconds

// File: /api/enrich-leads/route.ts (Next.js 13+ App Router)
// Or /pages/api/enrich-leads.ts (Next.js Pages Router)

import { NextRequest, NextResponse } from 'next/server';
import { enrichLeads, enrichSingleLead, LeadEnrichmentParams } from '@/lib/runEnrichment';

const MAX_EMAILS = 50; // hard cap to protect server

// Type for request body validation
interface EnrichLeadsRequest {
  emails: string[];
  chatModelProvider?: {
    name: string;
    provider: string;
  };
  embeddingModelProvider?: {
    name: string;
    provider: string;
  };
  focusMode?: string;
  optimizationMode?: string;
  systemInstructions?: string;
  singleMode?: boolean; // For testing single email enrichment
}

// Input validation function
function validateRequest(body: any): { isValid: boolean; error?: string; data?: EnrichLeadsRequest } {
  // Check if body exists
  if (!body) {
    return { isValid: false, error: 'Request body is required' };
  }

  // Check emails field
  if (!body.emails) {
    return { isValid: false, error: 'emails field is required' };
  }

  if (!Array.isArray(body.emails)) {
    return { isValid: false, error: 'emails must be an array' };
  }

  if (body.emails.length === 0) {
    return { isValid: false, error: 'At least one email is required' };
  }

  // Normalize, de-duplicate, and validate emails
  const normalizedEmails: string[] = Array.from(
    new Set(
      body.emails
        .filter((e: any) => typeof e === 'string')
        .map((e: string) => e.trim().toLowerCase())
        .filter(Boolean)
    )
  );

  if (normalizedEmails.length === 0) {
    return { isValid: false, error: 'No valid emails after normalization' };
  }

  // Enforce a reasonable upper bound to protect the server
  if (normalizedEmails.length > MAX_EMAILS) {
    return { isValid: false, error: `Too many emails. Max allowed is ${MAX_EMAILS}` };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const invalidEmails = normalizedEmails.filter((email: string) => !emailRegex.test(email));
  if (invalidEmails.length > 0) {
    return {
      isValid: false,
      error: `Invalid email format(s): ${invalidEmails.join(', ')}`
    };
  }

  // Validate optional fields
  if (body.chatModelProvider && 
      (!body.chatModelProvider.name || !body.chatModelProvider.provider)) {
    return { 
      isValid: false, 
      error: 'chatModelProvider must have both name and provider fields' 
    };
  }

  if (body.embeddingModelProvider && 
      (!body.embeddingModelProvider.name || !body.embeddingModelProvider.provider)) {
    return { 
      isValid: false, 
      error: 'embeddingModelProvider must have both name and provider fields' 
    };
  }

  return { isValid: true, data: { ...body, emails: normalizedEmails } as EnrichLeadsRequest };
}

// Main API handler
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    console.log('🚀 Lead enrichment API called at:', new Date().toISOString());
    
    // Parse request body
    let body;
    try {
      body = await request.json();
    } catch (error) {
      console.error('❌ Invalid JSON in request body:', error);
      return NextResponse.json(
        { 
          success: false,
          error: 'Invalid JSON in request body',
          message: 'Please ensure your request body contains valid JSON'
        },
        { status: 400 }
      );
    }

    // Validate request
    const validation = validateRequest(body);
    if (!validation.isValid) {
      console.error('❌ Validation failed:', validation.error);
      return NextResponse.json(
        { 
          success: false,
          error: 'Validation failed',
          message: validation.error 
        },
        { status: 400 }
      );
    }

    const validatedData = validation.data!;
    
    console.log('📧 Processing emails (count):', validatedData.emails.length);
    console.log('⚙️ Configuration:', {
      focusMode: validatedData.focusMode || 'webSearch',
      optimizationMode: validatedData.optimizationMode || 'speed',
      chatModel: validatedData.chatModelProvider || 'auto-detect',
      embeddingModel: validatedData.embeddingModelProvider || 'auto-detect',
      singleMode: validatedData.singleMode || false
    });

    // Prepare enrichment parameters
    const params: LeadEnrichmentParams = {
      emails: validatedData.emails.map(email => email.trim()),
      chatModelProvider: validatedData.chatModelProvider,
      embeddingModelProvider: validatedData.embeddingModelProvider,
      focusMode: validatedData.focusMode || 'webSearch',
      optimizationMode: validatedData.optimizationMode || 'speed',
      systemInstructions: validatedData.systemInstructions,
    };

    // Execute enrichment (single vs multiple)
    let result;
    if (validatedData.singleMode && validatedData.emails.length === 1) {
      console.log('🔍 Using single lead enrichment mode');
      result = await enrichSingleLead(validatedData.emails[0], {
        chatModelProvider: params.chatModelProvider,
        embeddingModelProvider: params.embeddingModelProvider,
        focusMode: params.focusMode,
        optimizationMode: params.optimizationMode,
        systemInstructions: params.systemInstructions,
      });
    } else {
      console.log('🔍 Using batch lead enrichment mode');
      result = await enrichLeads(params);
    }

    const processingTime = Date.now() - startTime;
    const resultsArr = Array.isArray((result as any)?.results) ? (result as any).results : [];
    const errorsArr = Array.isArray((result as any)?.errors) ? (result as any).errors : [];

    console.log(`✅ Enrichment completed in ${processingTime}ms`);
    console.log('📊 Results summary:', {
      success: !!(result as any)?.success,
      totalResults: resultsArr.length,
      errorsCount: errorsArr.length,
      successfulEnrichments: resultsArr.filter((r: any) => !r?.error).length
    });

    // Return results with additional metadata
    return NextResponse.json(
      {
        ...(result as any),
        results: resultsArr.map((r: any) => ({
          ...r,
          error: (r && typeof r.error === 'object' && r.error !== null)
            ? ((() => { try { return JSON.stringify(r.error); } catch { return String(r.error); } })())
            : r?.error
        })),
        errors: errorsArr.map((e: any) => {
          if (e instanceof Error) return e.message;
          if (typeof e === 'string') return e;
          try { return JSON.stringify(e); } catch { return String(e); }
        }),
        metadata: {
          processingTimeMs: processingTime,
          timestamp: new Date().toISOString(),
          totalEmails: params.emails.length,
          successfulEnrichments: resultsArr.filter((r: any) => !r?.error).length,
          failedEnrichments: resultsArr.filter((r: any) => r?.error).length
        }
      },
      {
        status: (result as any)?.success ? 200 : 207,
        headers: { 'Cache-Control': 'no-store' }
      }
    );

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error('💥 Critical error in lead enrichment API:', error);
    
    // Log error details for debugging
    if (error instanceof Error) {
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }

    return NextResponse.json(
      { 
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'An unexpected error occurred',
        metadata: {
          processingTimeMs: processingTime,
          timestamp: new Date().toISOString(),
          errorType: error instanceof Error ? error.constructor.name : 'UnknownError'
        }
      },
      { status: 500 }
    );
  }
}

// GET endpoint for API health check and documentation
export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    service: 'Lead Enrichment API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      POST: '/api/enrich-leads',
      description: 'Enrich lead information from email addresses'
    },
    usage: {
      method: 'POST',
      contentType: 'application/json',
      requiredFields: ['emails'],
      optionalFields: [
        'chatModelProvider',
        'embeddingModelProvider', 
        'focusMode',
        'optimizationMode',
        'systemInstructions',
        'singleMode'
      ],
      example: {
        emails: ['john@company.com', 'jane@startup.io'],
        focusMode: 'webSearch',
        optimizationMode: 'speed',
        chatModelProvider: {
          name: 'gpt-3.5-turbo',
          provider: 'openai'
        },
        singleMode: false
      }
    }
  }, { headers: { 'Cache-Control': 'no-store' } });
}