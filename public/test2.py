import requests,re,uuid,sys
from urllib.parse import urlparse, parse_qs, unquote

class FacebookTokenGenerator:
    def __init__(self, app_id, client_id, cookie):
        self.app_id = app_id
        self.client_id = client_id
        self.cookie_raw = re.sub(r"\s+", "", cookie, flags=re.UNICODE)
        self.cookies = self._parse_cookies()

    def _parse_cookies(self):
        result = {}
        try:
            for i in self.cookie_raw.strip().split(';'):
                result.update({i.split('=')[0]: i.split('=')[1]})
            return result
        except:
            for i in self.cookie_raw.strip().split('; '):
                result.update({i.split('=')[0]: i.split('=')[1]})
            return result

    def GetToken(self):
        try:
            c_user = self.cookies.get("c_user")
            if not c_user:
                raise ValueError("Không tìm thấy c_user trong cookie")

            headers_dtsg = {
                'authority': 'www.facebook.com',
                'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/jxl,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'accept-language': 'vi,en-US;q=0.9,en;q=0.8',
                'cache-control': 'max-age=0',
                'dnt': '1',
                'dpr': '1.25',
                'sec-ch-ua': '"Chromium";v="117", "Not;A=Brand";v="8"',
                'sec-ch-ua-full-version-list': '"Chromium";v="117.0.5938.157", "Not;A=Brand";v="8.0.0.0"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-model': '""',
                'sec-ch-ua-platform': '"Windows"',
                'sec-ch-ua-platform-version': '"15.0.0"',
                'sec-fetch-dest': 'document',
                'sec-fetch-mode': 'navigate',
                'sec-fetch-site': 'same-origin',
                'sec-fetch-user': '?1',
                'upgrade-insecure-requests': '1',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
                'viewport-width': '1038',
            }
            params = {
                'redirect_uri': 'fbconnect://success',
                'scope': 'email,public_profile',
                'response_type': 'token,code',
                'client_id': self.client_id,
            }
            
            get_data = requests.get(
                "https://www.facebook.com/v2.3/dialog/oauth",
                params=params,
                cookies=self.cookies,
                headers=headers_dtsg
            ).text
            
            fb_dtsg_match = re.search('DTSGInitData",,{"token":"(.+?)"', get_data.replace('[]', ''))
            if not fb_dtsg_match:
                raise ValueError("Không tìm thấy fb_dtsg trong response")
            fb_dtsg = fb_dtsg_match.group(1)

           
            headers_token = {
                'authority': 'www.facebook.com',
                'accept': '*/*',
                'accept-language': 'vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5',
                'content-type': 'application/x-www-form-urlencoded',
                'dnt': '1',
                'origin': 'https://www.facebook.com',
                'sec-ch-prefers-color-scheme': 'dark',
                'sec-ch-ua': '"Chromium";v="117", "Not;A=Brand";v="8"',
                'sec-ch-ua-full-version-list': '"Chromium";v="117.0.5938.157", "Not;A=Brand";v="8.0.0.0"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-model': '""',
                'sec-ch-ua-platform': '"Windows"',
                'sec-ch-ua-platform-version': '"15.0.0"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
                'x-fb-friendly-name': 'useCometConsentPromptEndOfFlowBatchedMutation',
            }

            data = {
                'av': str(c_user),
                '__user': str(c_user),
                'fb_dtsg': fb_dtsg,
                'fb_api_caller_class': 'RelayModern',
                'fb_api_req_friendly_name': 'useCometConsentPromptEndOfFlowBatchedMutation',
                'variables': '{"input":{"client_mutation_id":"4","actor_id":"' + c_user + '","config_enum":"GDP_READ","device_id":null,"experience_id":"' + str(
                    uuid.uuid4()
                ) + '","extra_params_json":"{\\"app_id\\":\\"' + ''+self.client_id+'' + '\\",\\"display\\":\\"\\\\\\"popup\\\\\\"\\",\\"kid_directed_site\\":\\"false\\",\\"logger_id\\":\\"\\\\\\"' + str(
                    uuid.uuid4()
                ) + '\\\\\\"\\",\\"next\\":\\"\\\\\\"read\\\\\\"\\",\\"redirect_uri\\":\\"\\\\\\"https:\\\\\\\\\\\\/\\\\\\\\\\\\/www.facebook.com\\\\\\\\\\\\/connect\\\\\\\\\\\\/login_success.html\\\\\\"\\",\\"response_type\\":\\"\\\\\\"token\\\\\\"\\",\\"return_scopes\\":\\"false\\",\\"scope\\":\\"[\\\\\\"email\\\\\\",\\\\\\"public_profile\\\\\\"]\\",\\"sso_key\\":\\"\\\\\\"com\\\\\\"\\",\\"steps\\":\\"{\\\\\\"read\\\\\\":[\\\\\\"email\\\\\\",\\\\\\"public_profile\\\\\\"]}\\",\\"tp\\":\\"\\\\\\"unspecified\\\\\\"\\",\\"cui_gk\\":\\"\\\\\\"[PASS]:\\\\\\"\\",\\"is_limited_login_shim\\":\\"false\\"}","flow_name":"GDP","flow_step_type":"STANDALONE","outcome":"APPROVED","source":"gdp_delegated","surface":"FACEBOOK_COMET"}}',
                'server_timestamps': 'true',
                'doc_id': '6494107973937368',
            }

            response = requests.post(
                'https://www.facebook.com/api/graphql/',
                cookies=self.cookies,
                headers=headers_token,
                data=data
            ).json()

            uri = response["data"]["run_post_flow_action"]["uri"]
            parsed_url = urlparse(uri)
            query_params = parse_qs(parsed_url.query)
            close_uri = query_params.get("close_uri", [None])[0]
            decoded_close_uri = unquote(close_uri)
            fragment = urlparse(decoded_close_uri).fragment
            fragment_params = parse_qs(fragment)
            access_token = fragment_params.get("access_token", [None])[0]

            if not access_token:
                raise ValueError("Không tìm thấy access_token trong response")
            
            session_ap = requests.post(
                'https://api.facebook.com/method/auth.getSessionforApp',
                data={
                    'access_token': access_token,
                    'format': 'json',
                    'new_app_id': self.app_id,
                    'generate_session_cookies': '1'
                }
            ).json()
            token_new = session_ap.get("access_token")

            if token_new:
                return token_new
            else:
                return False

        except ValueError as e:
            return False
        except Exception as e:
            return False
def GetToken(cookie_input):
    try:

        ResultToken = FacebookTokenGenerator(
            app_id="350685531728",  
            client_id="350685531728",
            cookie=cookie_input
        )
        return ResultToken.GetToken()
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as e:
        return False
print(GetToken('cookies_cua_ban'))