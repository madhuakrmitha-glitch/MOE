from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator


class Schema(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Credentials(Schema):
    email: str = Field(min_length=3, max_length=254)
    password: Annotated[str, StringConstraints(strip_whitespace=False)] = Field(
        min_length=12, max_length=128
    )

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value):
        value = value.lower()
        if "@" not in value or "." not in value.split("@")[-1]:
            raise ValueError("Use a valid email address")
        return value


class Registration(Credentials):
    name: str = Field(min_length=1, max_length=100)
    invite_token: str | None = Field(default=None, max_length=100)


class ConnectionInput(Schema):
    name: str = Field(min_length=1, max_length=100)
    kind: Literal["openai", "ollama", "huggingface"]
    base_url: str = Field(min_length=5, max_length=500)
    api_key: str | None = Field(default=None, max_length=4096)
    token_parameter: Literal["max_tokens", "max_completion_tokens"] = "max_tokens"
    supports_temperature: bool = True
    stream_enabled: bool = True
    include_usage: bool = False


class AgentInput(Schema):
    id: str | None = Field(default=None, pattern=r"^[0-9a-f-]{36}$")
    connection_id: str
    name: str = Field(min_length=1, max_length=60)
    model: str = Field(min_length=1, max_length=200)
    system_prompt: str = Field(
        default="Contribute a helpful perspective.", max_length=20000
    )
    enabled: bool = True
    temperature: float = Field(default=0.7, ge=0, le=2)
    max_tokens: int = Field(default=1024, ge=16, le=8192)
    color: str = Field(default="#6d78d5", pattern=r"^#[0-9a-fA-F]{6}$")


class RoomCreate(Schema):
    title: str = Field(default="Untitled room", min_length=1, max_length=120)


class RoomInput(RoomCreate):
    revision: int = Field(ge=1)
    shared_prompt: str = Field(max_length=20000)
    mode: Literal["round_robin", "broadcast", "moderated"] = "round_robin"
    rounds: int = Field(default=2, ge=1, le=10)
    max_turns: int = Field(default=16, ge=1, le=64)
    context_messages: int = Field(default=40, ge=1, le=100)
    failure_policy: Literal["continue", "stop"] = "continue"
    moderator_id: str | None = None
    agents: list[AgentInput] = Field(default_factory=list, max_length=16)


class RunInput(Schema):
    text: str = Field(min_length=1, max_length=20000)
    request_id: str = Field(min_length=1, max_length=80)
    target_agent_id: str | None = None


class InviteInput(Schema):
    email: str = Field(min_length=3, max_length=254)
    role: Literal["member", "viewer"] = "member"

    @field_validator("email")
    @classmethod
    def email_lower(cls, value):
        if "@" not in value:
            raise ValueError("Invalid email")
        return value.lower()


class MembershipInput(Schema):
    role: Literal["owner", "member", "viewer"]


class ConnectionTest(Schema):
    model: str = Field(min_length=1, max_length=200)
