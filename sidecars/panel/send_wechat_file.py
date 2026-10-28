#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WeChat Dispatcher - File Sender Helper
Uploads a local file to Tencent WeChat CDN and sends it to the WeChat user via iLink bot protocol.
"""

import argparse
import json
import os
import sys

# Force UTF-8 encoding on standard output/error (critical for Windows environments)
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

# Ensure chatgpt-on-wechat is in python path
COW_DIR = os.environ.get("COW_DIR", os.path.join(os.path.expanduser("~"), ".gemini", "antigravity", "scratch", "chatgpt-on-wechat"))
if os.path.exists(COW_DIR) and COW_DIR not in sys.path:
    sys.path.insert(0, COW_DIR)

try:
    from channel.weixin.weixin_api import WeixinApi, upload_media_to_cdn
except ImportError as e:
    print(json.dumps({"success": False, "error": f"Import WeixinApi failed: {str(e)}"}, ensure_ascii=False))
    sys.exit(1)


def send_file(file_path: str, user_id: str = "", text: str = ""):
    if not os.path.isfile(file_path):
        return {"success": False, "error": f"File not found: {file_path}"}

    file_size = os.path.getsize(file_path)
    file_name = os.path.basename(file_path)

    # Load credentials
    creds_path = os.path.expanduser("~/.weixin_cow_credentials.json")
    if not os.path.exists(creds_path):
        return {"success": False, "error": f"Credentials file not found: {creds_path}"}

    try:
        with open(creds_path, "r", encoding="utf-8") as f:
            creds = json.load(f)
    except Exception as e:
        return {"success": False, "error": f"Failed to load credentials: {str(e)}"}

    token = creds.get("token", "")
    base_url = creds.get("base_url", "https://ilinkai.weixin.qq.com")
    target_user = user_id or creds.get("user_id", "")
    context_tokens = creds.get("context_tokens", {})
    context_token = context_tokens.get(target_user, "")

    if not target_user:
        return {"success": False, "error": "No target user_id found"}
    if not context_token:
        # If user_id wasn't in context_tokens, take the first available context_token
        if context_tokens:
            target_user, context_token = next(iter(context_tokens.items()))
        else:
            return {
                "success": False,
                "error": f"暂无微信用户【{target_user}】的活跃会话凭证。微信官方限制机器人必须在用户发送消息后方可推送文件。请先在手机微信中给机器人发送任意一条消息（如回复“你好”或“1”）激活会话！"
            }

    api = WeixinApi(base_url=base_url, token=token)

    # 1. Upload file to WeChat CDN (media_type=3 means FILE)
    try:
        cdn_res = upload_media_to_cdn(api, file_path, target_user, media_type=3)
    except Exception as e:
        return {"success": False, "error": f"CDN upload failed: {str(e)}"}

    # 2. Send file message card
    try:
        resp = api.send_file_item(
            to=target_user,
            context_token=context_token,
            encrypt_query_param=cdn_res["encrypt_query_param"],
            aes_key_b64=cdn_res["aes_key_b64"],
            file_name=file_name,
            file_size=cdn_res["raw_size"]
        )
        if resp.get("ret") not in (0, None) and "message_id" not in resp:
            ret = resp.get("ret")
            errmsg = str(resp.get("errmsg") or "")
            if ret in (-2, -14) or "prepare failed" in errmsg:
                # Invalidate stale token from credentials file
                try:
                    if target_user in context_tokens:
                        del context_tokens[target_user]
                        creds["context_tokens"] = context_tokens
                        with open(creds_path, "w", encoding="utf-8") as f:
                            json.dump(creds, f, ensure_ascii=False, indent=2)
                except Exception:
                    pass
                return {
                    "success": False,
                    "error": "微信会话凭证已过期 (prepare failed)：微信官方限制机器人长期未互动后主动推送文件。请先在手机微信中给机器人发送任意一条消息（如回复“你好”或“1”）以刷新会话，然后即可正常直推！",
                    "ret": ret,
                    "errmsg": errmsg
                }
            return {"success": False, "error": f"Weixin API send_file error: {resp}"}
        
        msg_id = resp.get("message_id")
    except Exception as e:
        return {"success": False, "error": f"Send file message failed: {str(e)}"}

    # 3. Optional companion text notification
    if text:
        try:
            api.send_text(target_user, text, context_token)
        except Exception:
            pass

    return {
        "success": True,
        "message_id": msg_id,
        "file_name": file_name,
        "file_size": file_size,
        "target_user": target_user
    }


def send_text_msg(user_id: str = "", text: str = ""):
    if not text:
        return {"success": False, "error": "Empty text"}

    creds_path = os.path.expanduser("~/.weixin_cow_credentials.json")
    if not os.path.exists(creds_path):
        return {"success": False, "error": f"Credentials file not found: {creds_path}"}

    try:
        with open(creds_path, "r", encoding="utf-8") as f:
            creds = json.load(f)
    except Exception as e:
        return {"success": False, "error": f"Failed to load credentials: {str(e)}"}

    token = creds.get("token", "")
    base_url = creds.get("base_url", "https://ilinkai.weixin.qq.com")
    target_user = user_id or creds.get("user_id", "")
    context_tokens = creds.get("context_tokens", {})
    context_token = context_tokens.get(target_user, "")

    if not target_user:
        return {"success": False, "error": "No target user_id found"}
    if not context_token:
        if context_tokens:
            target_user, context_token = next(iter(context_tokens.items()))
        else:
            return {
                "success": False,
                "error": f"暂无微信用户【{target_user}】的活跃会话凭证。请先在手机微信中给机器人发送任意一条消息（如回复“你好”或“1”）激活会话！"
            }

    api = WeixinApi(base_url=base_url, token=token)
    try:
        resp = api.send_text(target_user, text, context_token)
        if resp.get("ret") not in (0, None) and "message_id" not in resp:
            ret = resp.get("ret")
            errmsg = str(resp.get("errmsg") or "")
            if ret in (-2, -14) or "prepare failed" in errmsg:
                try:
                    if target_user in context_tokens:
                        del context_tokens[target_user]
                        creds["context_tokens"] = context_tokens
                        with open(creds_path, "w", encoding="utf-8") as f:
                            json.dump(creds, f, ensure_ascii=False, indent=2)
                except Exception:
                    pass
                return {
                    "success": False,
                    "error": "微信会话凭证已过期 (prepare failed)：请先在手机微信中给机器人发送任意消息（如“1”或“你好”）以刷新会话凭证！",
                    "ret": ret,
                    "errmsg": errmsg
                }
            return {"success": False, "error": f"Weixin API send_text error: {resp}"}
        return {"success": True, "target_user": target_user, "resp": resp}
    except Exception as e:
        return {"success": False, "error": f"Failed to send text: {str(e)}"}


def main():
    parser = argparse.ArgumentParser(description="Send file or text to WeChat")
    parser.add_argument("--file", "-f", default="", help="Path to file")
    parser.add_argument("--user", "-u", default="", help="Target WeChat user ID")
    parser.add_argument("--text", "-t", default="", help="Text message content")
    args = parser.parse_args()

    if args.file:
        result = send_file(args.file, args.user, args.text)
    elif args.text:
        result = send_text_msg(args.user, args.text)
    else:
        result = {"success": False, "error": "Either --file or --text must be specified"}

    out_bytes = (json.dumps(result, ensure_ascii=False) + "\n").encode("utf-8")
    sys.stdout.buffer.write(out_bytes)
    sys.stdout.buffer.flush()
    if not result.get("success"):
        sys.exit(1)


if __name__ == "__main__":
    main()
