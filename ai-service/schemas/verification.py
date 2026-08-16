"""PSS06 - Request/response contracts between the Node backend and the AI service."""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class VerifyRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=300,
                       description="The proposed publication title")
    language: Optional[str] = Field(None, description="Declared language")
    publicationType: Optional[str] = Field(None, description="Newspaper / Magazine / ...")
    periodicity: Optional[str] = None
    publisher: Optional[str] = None
    state: Optional[str] = None
    applicantId: Optional[str] = None
    topK: Optional[int] = Field(None, ge=1, le=25)
    explain: bool = True


class GuidelineRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=300)


class RegisterPendingRequest(BaseModel):
    """Add a submitted application to the live corpus (requirement 5.b)."""

    title: str
    applicationRef: str
    language: Optional[str] = None
    periodicity: Optional[str] = None
    publisher: Optional[str] = None
    state: Optional[str] = None


class ScoreBreakdown(BaseModel):
    semantic: float
    reranker: float
    fuzzy: float
    phonetic: float
    token: float
    coreOverlap: float
    conceptOverlap: float


class SimilarTitle(BaseModel):
    title: str
    similarity: float
    scores: Dict[str, float]
    matchedVia: List[str]
    metadata: Dict[str, Any]


class FindingModel(BaseModel):
    code: str
    rule: str
    severity: str
    message: str
    requirement: str
    evidence: Dict[str, Any]
    penalty: float


class AgentStep(BaseModel):
    step: int
    tool: str
    summary: str
    durationMs: float


class VerifyResponse(BaseModel):
    title: str
    normalizedTitle: str
    decision: str
    similarityScore: float
    verificationProbability: float
    confidence: str
    findings: List[FindingModel]
    checksPassed: List[str]
    similarTitles: List[SimilarTitle]
    explanation: str
    explanationSource: str
    suggestions: List[str]
    agentTrace: List[AgentStep]
    engine: Dict[str, Any]
    processingMs: float
