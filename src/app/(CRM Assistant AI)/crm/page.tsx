"use client"

import ChatWindow from "@/components/ChatWindow"
import { useState, useEffect, useRef } from "react"

// Question templates for the enrichment process
const questionTemplates = [
  "What does COMPANY company do?",
  "What is the website of the company with the domain COMPANY?",
  "What are the revenue figures for the company with the domain COMPANY?",
  "What is the employee size of COMPANY company?",
  "How many years has COMPANY company been in business?",
  "What is the latest funding news for COMPANY company?",
  "Is COMPANY in the Fortune 500 list?",
  "Is COMPANY in the Fortune 100 list?",
  "Who are the clients of COMPANY?",
  "What is the industry classification of COMPANY?",
  "What is the LinkedIn profile link of the company named COMPANY?",
]

interface EnrichmentData {
  question: string
  answer: string
}

interface ApiResponse {
  results: Array<{
    score: number
    reason: string
    enrichmentData: EnrichmentData[]
    structuredFields: Record<string, any>
  }>
}

export default function LeadAssistantWidget() {
  const [isLoading, setIsLoading] = useState(false)
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(-1)
  const [logs, setLogs] = useState<string[]>([])
  const [score, setScore] = useState<number | null>(null)
  const [reason, setReason] = useState<string>("")
  const [qaData, setQaData] = useState<EnrichmentData[]>([])
  const [companyName, setCompanyName] = useState<string>("")
  const logOutputRef = useRef<HTMLDivElement>(null)

  // Auto-scroll logs
  useEffect(() => {
    if (logOutputRef.current) {
      logOutputRef.current.scrollTop = logOutputRef.current.scrollHeight
    }
  }, [logs])

  const showLog = (message: string) => {
    setLogs((prev) => [...prev, message])
  }

  const startProgressLoader = (leadEmail: string) => {
    const domain = leadEmail.split("@")[1]
    const company = domain.split(".")[0]
    setCompanyName(company)
    setCurrentQuestionIndex(-1)

    const updateLoader = () => {
      setCurrentQuestionIndex((prev) => {
        if (prev === -1) {
          setTimeout(() => setCurrentQuestionIndex(0), 4000)
          return -1
        } else if (prev < questionTemplates.length) {
          if (prev < questionTemplates.length - 1) {
            setTimeout(() => setCurrentQuestionIndex(prev + 1), 12000)
          }
          return prev + 1
        }
        return prev
      })
    }

    updateLoader()
  }

  const callLLMApiWithEmail = async (leadEmail: string, leadId?: string) => {
    if (!leadEmail) {
      showLog("No lead email provided for LLM API call.")
      return
    }

    showLog("Calling LLM API with lead email: " + leadEmail)
    showLog("Note: This may take up to 5 minutes depending on the LLM response time.")
    startProgressLoader(leadEmail)
    setIsLoading(true)

    try {
      const response = await fetch("http://localhost:3000/api/enrich-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: [leadEmail] }),
      })

      if (!response.ok) {
        throw new Error("LLM API response error: " + response.status)
      }

      const data: ApiResponse = await response.json()
      showLog("Received response from LLM API")

      if (data && data.results && data.results.length > 0) {
        const firstResult = data.results[0]
        setScore(firstResult.score || 0)
        setReason(firstResult.reason || "No reason provided")
        setQaData(firstResult.enrichmentData || [])

        // Update Zoho CRM if leadId is provided
        if (leadId && typeof window !== "undefined" && (window as any).ZOHO) {
          updateLeadRecordWithStructuredFields(leadId, firstResult.structuredFields)
          createQuestionsFromLLM(firstResult.enrichmentData, leadId, firstResult.score, firstResult.reason)
        }
      } else {
        setScore(null)
        setReason("No reason provided.")
      }
    } catch (error) {
      showLog("Error calling LLM API: " + (error as Error).message)
      setScore(null)
      setReason("Error fetching data: " + (error as Error).message)
    } finally {
      setIsLoading(false)
      setCurrentQuestionIndex(-1)
    }
  }

  const triggerLeadProcess = () => {
    showLog("Initializing Zoho SDK...")

    if (typeof window === "undefined" || !(window as any).ZOHO || !(window as any).ZOHO.embeddedApp) {
      showLog("Zoho SDK not found. Using demo data for preview.")
      // Demo data for preview
      callLLMApiWithEmail("demo@techcorp.com")
      return
    }

    const ZOHO = (window as any).ZOHO

    ZOHO.embeddedApp.on("PageLoad", (data: any) => {
      const leadId = data.EntityId && data.EntityId[0]
      if (leadId) {
        ZOHO.CRM.API.getRecord({ Entity: "Leads", RecordID: leadId })
          .then((response: any) => {
            if (response.data && response.data.length > 0) {
              const leadData = response.data[0]
              const leadEmail = leadData.Email
              if (leadEmail) {
                callLLMApiWithEmail(leadEmail, leadId)
              } else {
                showLog("Lead Email not found in record.")
              }
            } else {
              showLog("Lead data not found for ID: " + leadId)
            }
          })
          .catch((error: Error) => showLog("Error fetching Lead Data: " + error.message))
      } else {
        showLog("Lead ID not found in Zoho event")
      }
    })

    ZOHO.embeddedApp.init().catch((error: Error) => showLog("Error initializing Zoho SDK: " + error.message))
  }

  const updateLeadRecordWithStructuredFields = (leadId: string, structuredFields: Record<string, any>) => {
    const fieldMapping = {
      "Customer Type": "Customer_Type",
      "Contact Search": "Contact_Search",
      Phone: "Phone",
      Mobile: "Mobile",
      Description: "Description",
      Street: "Street",
      City: "City",
      State: "State",
      "Zip Code": "Zip_Code",
      Country: "Country",
    }

    const APIData: any = { id: leadId }
    Object.entries(structuredFields).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        const zohoFieldKey = (fieldMapping as any)[key]
        if (zohoFieldKey) APIData[zohoFieldKey] = value
      }
    })

    const config = { Entity: "Leads", APIData }
    const ZOHO = (window as any).ZOHO

    ZOHO.CRM.API.updateRecord(config)
      .then((response: any) => {
        if (response && Array.isArray(response.data) && response.data.length > 0) {
          const result = response.data[0]
          if (result.code === "SUCCESS") {
            showLog("Lead record updated successfully in the fields of CRM.")
          } else {
            showLog("Failed to update lead record: " + JSON.stringify(result))
          }
        } else {
          showLog("Unexpected response while updating lead: " + JSON.stringify(response))
        }
      })
      .catch((error: Error) => showLog("Error updating lead record: " + error.message))
  }

  const createQuestionsFromLLM = (
    enrichmentData: EnrichmentData[],
    leadRecordId: string,
    score: number,
    reason: string,
  ) => {
    enrichmentData.forEach((item) => {
      const questionText = item.question.split("?")[0] + "?"
      const answerText = item.answer
      createQuestionRecord(questionText, answerText, leadRecordId)
    })

    const scoreAndBreakdown = `Score: ${score}/90\nScore Break down:\n${reason.split("Reason:")[0].trim()}`
    createQuestionRecord("Lead Score and Breakdown", scoreAndBreakdown, leadRecordId)

    const reasonText = reason.includes("Reason:") ? reason.split("Reason:")[1].trim() : reason
    createQuestionRecord("Lead Score Reason", reasonText, leadRecordId)
  }

  const createQuestionRecord = (questionText: string, answerText: string, leadRecordId: string) => {
    const truncatedQuestion = truncateToMaxLength(questionText, 255)
    const truncatedAnswer = truncateToMaxLength(answerText, 255)

    const questionData = {
      Name: truncatedQuestion,
      Answer: truncatedAnswer,
      lead_name: leadRecordId,
    }

    const config = { Entity: "Questions", APIData: questionData }
    const ZOHO = (window as any).ZOHO

    ZOHO.CRM.API.insertRecord(config)
      .then((response: any) => {
        if (response && Array.isArray(response.data)) {
          response.data.forEach((result: any) => {
            if (result.code !== "SUCCESS") {
              showLog(`API Error creating record: Code=${result.code}, Message=${result.message}`)
            }
          })
        } else {
          showLog("Unexpected response format: ")
        }
      })
      .catch((error: Error) => showLog("Network or SDK error: " + (error.message || JSON.stringify(error))))
  }

  const truncateToMaxLength = (str: string, maxLength = 255) => {
    if (!str) return ""
    return str.length > maxLength ? str.substring(0, maxLength) : str
  }

  const getLoaderText = () => {
    if (currentQuestionIndex === -1) {
      return `LLM fetching results for ${companyName}`
    } else if (currentQuestionIndex < questionTemplates.length) {
      const currentQuestion = questionTemplates[currentQuestionIndex].replace(/COMPANY/g, companyName)
      return `LLM fetching results for: "${currentQuestion}" (${currentQuestionIndex + 1}/${questionTemplates.length})`
    } else {
      return "Intelligent lead scoring in progress..."
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50 relative overflow-hidden">
      {/* Background decorative elements */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[20%] left-[20%] w-64 h-64 bg-blue-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-[20%] right-[20%] w-64 h-64 bg-blue-600/10 rounded-full blur-3xl" />
      </div>

      <div className="max-w-4xl mx-auto p-8 flex flex-col gap-8 min-h-screen justify-center relative z-10">
        {/* Main Widget Container */}
        <div className="bg-white/80 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-12 text-center relative overflow-hidden shadow-xl">
          {/* Decorative background glow */}
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-blue-600/5 pointer-events-none" />
          <div className="absolute -top-1/2 -right-1/5 w-48 h-48 bg-blue-500/20 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10">
            {/* Header Section */}
            <div className="mb-10">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl mb-6 animate-bounce shadow-lg shadow-blue-500/30">
                <svg
                  className="w-10 h-10 text-white"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M12 2L13.09 7.26L18 8L13.09 8.74L12 14L10.91 8.74L6 8L10.91 7.26L12 2Z"
                    fill="currentColor"
                  />
                  <path
                    d="M19 10L19.74 12.26L22 13L19.74 13.74L19 16L18.26 13.74L16 13L18.26 12.26L19 10Z"
                    fill="currentColor"
                  />
                  <path d="M7 21L7.5 19.5L9 19L7.5 18.5L7 17L6.5 18.5L5 19L6.5 19.5L7 21Z" fill="currentColor" />
                </svg>
              </div>
              <h1 className="text-5xl font-extrabold bg-gradient-to-r from-gray-900 to-blue-600 bg-clip-text text-transparent mb-4 tracking-tight">
                Lead Assistant AI
              </h1>
              <p className="text-xl text-gray-600 font-medium max-w-2xl mx-auto leading-relaxed">
                The smart way to enhance and qualify leads in Zoho CRM
              </p>
            </div>

            {/* Enrich Button */}
            <button
              onClick={triggerLeadProcess}
              disabled={isLoading}
              className="group relative inline-flex items-center gap-3 bg-blue-600 hover:bg-blue-700 text-white text-lg font-semibold px-10 py-4 rounded-2xl transition-all duration-300 hover:scale-105 hover:shadow-2xl hover:shadow-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden shadow-lg"
            >
              <span className="relative z-10 font-semibold">Enrich Lead</span>
              <svg
                className="w-5 h-5 transition-transform duration-300 group-hover:rotate-12 group-hover:scale-110 relative z-10"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M13 10V3L4 14H11V21L20 10H13Z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {/* Button glow effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
            </button>
          </div>
        </div>
        <ChatWindow />

        {/* Log Output */}
        {logs.length > 0 && (
          <div className="bg-white/80 backdrop-blur-xl border border-gray-200/50 rounded-2xl p-6 shadow-lg">
            <div ref={logOutputRef} className="max-h-72 overflow-y-auto font-mono text-sm space-y-2">
              {logs.map((log, index) => (
                <div
                  key={index}
                  className="flex items-center gap-3 py-2 text-gray-600 animate-in slide-in-from-left duration-300"
                >
                  <div className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-pulse flex-shrink-0" />
                  {log}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Loader */}
        {isLoading && (
          <div className="flex flex-col items-center gap-6 bg-white/80 backdrop-blur-xl border border-blue-200/50 rounded-2xl p-8 animate-pulse shadow-lg shadow-blue-500/20">
            <div className="relative">
              <div className="w-15 h-15 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
              <div className="absolute inset-0 w-15 h-15 border-4 border-transparent border-r-blue-400 rounded-full animate-spin animate-reverse" />
            </div>
            <span className="text-lg font-medium text-gray-600">{getLoaderText()}</span>
          </div>
        )}

        {/* Score Display */}
        {score !== null && (
          <div className="animate-in fade-in slide-in-from-bottom duration-600">
            <div className="bg-white/80 backdrop-blur-xl border border-gray-200/50 rounded-2xl p-8 text-center relative overflow-hidden shadow-lg">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-transparent to-blue-600/5 pointer-events-none" />

              <div className="relative z-10">
                <div className="inline-flex items-center justify-center w-15 h-15 bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl mb-4 animate-bounce shadow-lg">
                  <svg
                    className="w-8 h-8 text-white"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M9 12L11 14L15 10M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mb-4">Lead Score</h3>

                <div className="text-6xl font-bold bg-gradient-to-r from-blue-600 to-blue-700 bg-clip-text text-transparent mb-4 animate-pulse">
                  {score}/90
                </div>

                <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-600 to-blue-700 rounded-full shadow-lg shadow-blue-500/50 transition-all duration-1500 ease-out"
                    style={{ width: `${(score / 90) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Reason Text */}
        {reason && (
          <div className="animate-in fade-in slide-in-from-bottom duration-600 delay-200">
            <div className="bg-white/80 backdrop-blur-xl border border-gray-200/50 rounded-2xl p-6 relative">
              <div className="absolute left-6 -top-2 w-4 h-4 bg-blue-600 rounded-full animate-pulse" />
              <h3 className="text-xl font-bold text-gray-900 mb-2">Score Breakdown & Reason</h3>
              <p className="text-gray-600 leading-relaxed italic">{reason}</p>
            </div>
          </div>
        )}

        {/* Q&A Section */}
        {qaData.length > 0 && (
          <div className="animate-in fade-in slide-in-from-bottom duration-600 delay-300">
            <div className="bg-white/80 backdrop-blur-xl border border-gray-200/50 rounded-2xl p-8 shadow-lg">
              <div className="flex items-center gap-3 mb-6">
                <svg
                  className="w-6 h-6 text-blue-600"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M9.663 17H4.78C4.36 17 3.98 16.82 3.69 16.49C3.4 16.16 3.25 15.74 3.25 15.3V4.7C3.25 4.26 3.4 3.84 3.69 3.51C3.98 3.18 4.36 3 4.78 3H19.22C19.64 3 20.02 3.18 20.31 3.51C20.6 3.84 20.75 4.26 20.75 4.7V15.3C20.75 15.74 20.6 16.16 20.31 16.49C20.02 16.82 19.64 17 19.22 17H14.337L9.663 17Z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M7 9H17"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M7 13H13"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <h3 className="text-xl font-bold text-gray-900">Questions & Answers</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {qaData.map((item, index) => (
                  <div
                    key={index}
                    className="group bg-gray-50/50 border border-gray-200/50 rounded-xl p-5 transition-all duration-300 hover:bg-blue-50/50 hover:border-blue-200/50 hover:-translate-y-1 relative overflow-hidden"
                  >
                    <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-blue-600 to-blue-700" />
                    <div className="font-semibold text-gray-900 mb-2 text-sm">Q: {item.question}</div>
                    <div className="text-gray-600 text-sm leading-relaxed">A: {item.answer || "N/A"}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
