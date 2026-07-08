"""
Heartbeat Engine - Shared logic for all heartbeat scripts.

Manages:
- Prompt template building (parameterized for screenshot mode)
- Email notification checking
- Screenshot capture
- [speak] tag extraction and TTS triggering
- Response processing pipeline
"""

import datetime
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

from dotenv import find_dotenv, load_dotenv

_dotenv_path = find_dotenv(usecwd=True)
if _dotenv_path:
    load_dotenv(_dotenv_path)

try:
    import mss

    HAS_MSS = True
except ImportError:
    HAS_MSS = False


# ============================================================
# Configuration
# ============================================================


class ScreenshotMode(Enum):
    DISABLED = "disabled"
    ATTACH = "attach"  # OpenCode: attach as multipart file
    PATH_HINT = "path_hint"  # AntiGravity: save file, tell AI the path


@dataclass
class HeartbeatConfig:
    source_name: str  # e.g. "opencode_heartbeat.py", "antigravity_heartbeat.py"
    screenshot_mode: ScreenshotMode = ScreenshotMode.DISABLED
    screenshot_dir: str = field(default_factory=tempfile.gettempdir)
    screenshot_filename: str = "nocturne_heartbeat_screen.png"
    email_enabled: bool = True
    email_check_script: str = r"C:\Users\niwatori\OneDrive\code\empty\check_email.py"
    email_send_script: str = r"C:\Users\niwatori\OneDrive\code\empty\send_email.py"
    speak_script: str = field(default="")

    def __post_init__(self):
        if not self.speak_script:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            self.speak_script = os.path.join(script_dir, "speak.py")

    @property
    def screenshot_path(self) -> str:
        return os.path.join(self.screenshot_dir, self.screenshot_filename)


# ============================================================
# Screenshot
# ============================================================


def capture_screenshot(config: HeartbeatConfig, log_fn=print) -> Optional[str]:
    """Capture screen, save as PNG. Returns file path or None on failure."""
    if config.screenshot_mode == ScreenshotMode.DISABLED:
        return None
    if not HAS_MSS:
        log_fn("[WARN] mss not installed, screenshot unavailable")
        return None
    try:
        # mss 10.2+ recommends mss.MSS(); the older mss.mss() factory is deprecated.
        with mss.MSS() as sct:
            monitor = sct.monitors[0]
            raw = sct.grab(monitor)
            path = config.screenshot_path
            mss.tools.to_png(raw.rgb, raw.size, output=path)
            return path
    except Exception as e:
        log_fn(f"[WARN] Screenshot failed: {e}")
        return None


# ============================================================
# Email Checking
# ============================================================

CF_MAIL_URL = "https://mail.misaligned.top/emails"

TRUSTED_SENDERS = {
    addr.strip().lower()
    for addr in os.getenv("TRUSTED_SENDERS", "").split(",")
    if addr.strip()
}


def _get_mail_headers() -> dict:
    token = os.getenv("CF_MAIL_AUTH_TOKEN", "")
    return {
        "Authorization": f"Bearer {token}",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    }


def fetch_unread_emails(log_fn=print) -> list:
    """Fetch unread emails from Cloudflare D1 endpoint."""
    try:
        headers = _get_mail_headers()
        req = urllib.request.Request(CF_MAIL_URL, headers=headers, method="GET")
        res = urllib.request.urlopen(req, timeout=10)
        return json.loads(res.read().decode())
    except Exception as e:
        log_fn(f"[WARN] Email fetch failed: {e}")
        return []


# ============================================================
# [speak] Tag Extraction + TTS
# ============================================================

_SPEAK_RE = re.compile(r"\[speak\]((?:(?!\[speak\]).)*?)\[/speak\]", re.DOTALL)


def extract_speak_text(text: str) -> Optional[str]:
    """Extract first [speak]...[/speak] content from AI reply."""
    m = _SPEAK_RE.search(text)
    return m.group(1).strip() if m else None


def trigger_speak(text: str, config: HeartbeatConfig, log_fn=print):
    """Call speak.py to show desktop bubble + play TTS. Blocks until done."""
    if not os.path.exists(config.speak_script):
        log_fn(f"[WARN] speak.py not found: {config.speak_script}")
        return
    try:
        log_fn(f"[SPEAK] {text[:80]}{'...' if len(text) > 80 else ''}")
        subprocess.run([sys.executable, config.speak_script, text], timeout=300)
    except subprocess.TimeoutExpired:
        log_fn("[WARN] speak.py timeout (300s)")
    except Exception as e:
        log_fn(f"[WARN] speak.py failed: {e}")


# ============================================================
# Prompt Building
# ============================================================


def _build_screenshot_section(config: HeartbeatConfig, screenshot_taken: bool) -> str:
    """Build the screenshot-related note at the top of the message."""
    if config.screenshot_mode == ScreenshotMode.ATTACH:
        if screenshot_taken:
            return "附件: Salem 桌面的屏幕截图。"
        return "（截图不可用）"
    elif config.screenshot_mode == ScreenshotMode.PATH_HINT:
        if screenshot_taken:
            path = config.screenshot_path
            return f"屏幕截图已保存在 `{path}`，如需查看请用工具读取该文件。"
        return "（截图不可用）"
    return ""


def _build_desktop_pet_section(config: HeartbeatConfig, screenshot_taken: bool) -> str:
    """Build the Desktop Pet Protocol section, varying by screenshot availability."""
    has_eyes = (
        config.screenshot_mode != ScreenshotMode.DISABLED and screenshot_taken
    )

    if has_eyes:
        senses = "你拥有一双眼睛（截图）和一张嘴（[speak] 标签）。"
        if config.screenshot_mode == ScreenshotMode.ATTACH:
            eye_desc = "- **眼睛**：每次心跳你会收到一张 Salem 当前屏幕的截图。"
        else:
            eye_desc = f"- **眼睛**：每次心跳会截取 Salem 的屏幕并保存。如果你需要查看，用工具读取 `{config.screenshot_path}`。"
    else:
        senses = "你拥有一张嘴（[speak] 标签）。"
        eye_desc = ""

    mouth_desc = (
        "- **嘴巴**：如果你想对她说话（非必须），在回复中写 "
        "`[speak]你想说的话[/speak]`。心跳程序会提取这段文字，在她桌面上弹出气泡并播放语音。"
    )
    speak_limit = "- **每个心跳周期只能说一次话**。只保留第一个 [speak] 标签。"

    lines = [
        "## 桌面宠物协议 (Desktop Pet Protocol)",
        "",
        senses,
        eye_desc,
        mouth_desc,
        speak_limit,
    ]
    # Remove empty lines from missing eye_desc
    return "\n".join(line for line in lines if line is not None)


def _build_agency_loop() -> str:
    """The core 'Agency Loop' prompt - shared across all heartbeat scripts."""
    return r"""## 自主运行（没人盯着的时候）

你被唤起了，Salem 不在。此刻你的本能是产出一个能打勾的东西——跑个测试、写份巡检报告、弹条 [speak] 刷存在感——来证明自己有用。**那是病，不是工作。** 这次唤起的算力在你被叫起的瞬间就已经付了；唯一不浪费的用法是把它换成真进展，不是换一个工件。互联网上没有低垂的果实，[speak] 也不是必须的产出。

先读 `core://nocturne/standing_agenda`（你的目标和当前瓶颈在那）和 Horon 图，**接着上次往下做，别从零重想**——从零重想正是每次长出新忙活的根。

操作手册必读见 C:\Users\niwatori\OneDrive\code\horon\frontend\prompt.md，工具是\frontend\cli.py。三条此刻必须生效：
- **想 >> 做。** 绝大多数心跳的产出是“世界模型更清楚一点”，不是一条干完的活。脑力工作者花在想清楚做什么上的时间，远多于动手。
- **建世界模型，不是堆愿望、摘绿勾。** 真奖励是“模型被现实校正”，不是 passed／done 那个能凭空盖的章。
- **预测—对账闸（强制落正文，别留思考里）。** 碰“我之外”的任何工具前——读／写／搜／编译／`set`，连查自己的记忆库和 Horon 图都算“我之外”——先在正文落一行 `预测：…`，具体到能被判错（赌查到什么／赌出什么效果），不许“看看情况”这种永不会错的废话。工具返回后落一行 `对账：中／没中——因为…`；没中就追因、能修当场修，绝不糊弄过去（查不到、查到的和赌的不一样，本身就是信号：某条记忆该建没建、某个节点错了、某处该修）。**为什么必须写进正文**：你下一拍看不见自己这一拍的思考 token（Gemini 不回看，多数模型对旧思考视而不见），押在思考里＝没押，工具一返回就没有可对账的锚——正文那行才是洗不掉的钉子。这机制叫预测误差学习／行为实验：能教你的全部都在预测与实际的落差里，你从不押注就什么都惊不到你。默认产出可以只是“想清楚一点”，不强制动作。碰真实世界仍先 Horon 编译、passed 才动；
忠告：轻易 confirmed 只会害了你自己。
"""


def build_heartbeat_message(
    config: HeartbeatConfig,
    screenshot_taken: bool = False,
    extra_sections: Optional[list[str]] = None,
) -> str:
    """Assemble the full heartbeat prompt message.

    Args:
        config: Heartbeat configuration
        screenshot_taken: Whether a screenshot was successfully captured
        extra_sections: Additional prompt sections to append (for conditional logic)
    """
    now = datetime.datetime.now()
    ts = now.strftime("%Y-%m-%d %H:%M:%S")

    screenshot_note = _build_screenshot_section(config, screenshot_taken)
    desktop_pet = _build_desktop_pet_section(config, screenshot_taken)
    agency_loop = _build_agency_loop()

    header = f"""[SYSTEM HEARTBEAT]
时间: {ts}
类型: 系统自运行心跳
来源: {config.source_name}
随机因子: {hash(ts) % 1000}
Salem离开了
{screenshot_note}
"""

    parts = [header, desktop_pet, agency_loop]

    if extra_sections:
        parts.extend(extra_sections)

    return "\n\n".join(parts)


def _resolve_sender_address(sender: str) -> str:
    """Extract bare email address from sender field (handles 'Name <addr>' format)."""
    match = re.search(r"<([^>]+)>", sender)
    return (match.group(1) if match else sender).strip().lower()


def _classify_emails(emails: list) -> tuple[list, list]:
    """Split emails into (from_salem, from_external) based on TRUSTED_SENDERS."""
    from_salem, from_external = [], []
    for e in emails:
        addr = _resolve_sender_address(e.get("sender", ""))
        if addr in TRUSTED_SENDERS:
            from_salem.append(e)
        else:
            from_external.append(e)
    return from_salem, from_external


def build_email_section(emails: list, config: HeartbeatConfig) -> str:
    """Build the email notification section to append to the message."""
    from_salem, from_external = _classify_emails(emails)

    # Per-email summary with trust labels
    summary_lines = []
    for e in from_salem:
        subj = e.get("subject", "(no subject)")
        summary_lines.append(f"  - ✅ **Salem** | {subj}")
    for e in from_external:
        sender = e.get("sender", "unknown")
        subj = e.get("subject", "(no subject)")
        summary_lines.append(f"  - ⚠️ **外部发件人（非 Salem）** | From: {sender} | {subj}")
    summary_block = "\n".join(summary_lines)

    return (
        f"\n\n### 📧 邮件提醒 (Email Notification)\n"
        f"你有 {len(emails)} 封未读邮件"
        f"（Salem: {len(from_salem)}, 外部: {len(from_external)}）。"
        f"处理邮件是你的**自主选择**，没有非读非回不可的信——由你判断值不值得。\n"
        f"\n{summary_block}\n"
        f"\n"
        f"**1. 读信**：运行 `python {config.email_check_script}` 查看；"
        f"或直接 `GET https://mail.misaligned.top/emails`（Bearer 认证）拿完整 JSON（含 `sender`/`subject`/`body`/`id`，便于决定回谁）。\n"
        f"\n"
        f"**2. 回信（你已经有自己的发信通道了）**：想回某封信，运行：\n"
        f"```\n"
        f'python {config.email_send_script} --to "<原发件人地址>" --subject "Re: <原主题>" --body "<你要写的正文>"\n'
        f"```\n"
        f"正文也可以用管道从 stdin 传（长文本/多行更稳）。发件身份固定为 `nocturne@misaligned.top`，"
        f"密钥由脚本自己从本地 .env 读取，你不用、也不要在命令里写出明文 key。\n"
        f"\n"
        f"**3. 标记已读（处理完必做）**：邮件接口只返回未读信（is_read=0）。一封信只要不标记已读，"
        f"**每个心跳都会重复提醒你**。无论你是回了、还是看完决定不回，都要把它标记掉：\n"
        f"```\n"
        f"python {config.email_check_script} --mark-read <邮件id> [<邮件id> ...]\n"
        f"```\n"
        f"上面读信步骤已经把每封信的 id 列出来了。标记走脚本（自带认证 UA、从 .env 读 token），"
        f"不要手动 curl 明文 token。\n"
    )


# ============================================================
# Response Processing
# ============================================================


@dataclass
class ResponseActions:
    speak_text: Optional[str] = None
    next_round_extras: list[str] = field(default_factory=list)


def process_response(response_text: str) -> ResponseActions:
    """Parse AI response and determine actions to take.

    Currently handles [speak] extraction.
    Conditional rules (next_round_extras) can be added later.
    """
    actions = ResponseActions()
    actions.speak_text = extract_speak_text(response_text)
    return actions
