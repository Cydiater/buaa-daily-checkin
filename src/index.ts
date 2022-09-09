import randomUserAgent from 'random-useragent';
import * as t from 'io-ts';
import { isLeft } from "fp-ts/lib/These";

class InvalidGaodeResp extends Error {
    json: object;

    constructor(json: object) {
        super();
        this.json = json;
    }
};

class InvalidUserInfo extends Error {
    json: object;

    constructor(json: object) {
        super();
        this.json = json;
    }
};

class UserNotFound extends Error {
    id: number;

    constructor(id: number) {
        super();
        this.id = id;
    }
};

class LoginError extends Error {
    message: string;

    constructor(message: string) {
        super();
        this.message = message;
    }
};

class WrongCommandError extends Error {
    command: string;

    constructor(command: string) {
        super();
        this.command = command;
    }
};

class WrongCheckinTime extends Error {
    checkin_time: string;

    constructor(checkin_time: string) {
        super();
        this.checkin_time = checkin_time;
    }
}

class NotTelegramUpdateError extends Error {
    json: object;

    constructor(json: object) {
        super();
        this.json = json;
    }
}

const GaodeResp = t.type({
    regeocode: t.type({
        formatted_address: t.string,
        addressComponent: t.type({
            province: t.string,
            city: t.union([t.readonlyArray(t.string), t.string]),
            district: t.string,
        })
    })
});

const BuaaResp = t.type({
    e: t.number,
    m: t.string,
});

const checkin_hh = t.union([
    t.literal(16), 
    t.literal(17), 
    t.literal(18), 
    t.literal(19),
]);

const checkin_mm = t.union([t.literal(0), t.literal(30)]);

const TelegramMessageLocation = t.type({
    longitude: t.number,
    latitude: t.number,
});

const UserInfo = t.type({
    username: t.string,
    password: t.string,
    chat_id: t.number,
    hh: checkin_hh,
    mm: checkin_mm,
    skip: t.number,
    area: t.string,
    city: t.string,
    province: t.string,
    address: t.string,
    location: TelegramMessageLocation,
    in_campus: t.boolean,
});

export interface Env {
    kv: KVNamespace,
    GaodeToken: string,
    TelegramToken: string,
}

const login_url = "https://app.buaa.edu.cn/uc/wap/minigram/check";
const checkin_url = "https://app.buaa.edu.cn/buaaxsncov/wap/default/save"
const telegram_bot_url = "https://api.telegram.org/bot";
const gaode_url = "https://restapi.amap.com/v3/geocode/regeo";
const help =
`
- /start: help messages
- /info: stored information about current user
- /login <username> <password>: store the buaa credential and enable daily checkin
- /checkin_at <time>: set checkin time, the hours should between 16 and 19, the minutes should be 0 or 30. Default: 17:30. Example: /checkin_at 18:30. 
    - /in_campus: set in campus     
- /out_of_campus: set out of campus
- /delete: erase stored information about current user
- /skip: add one skip day
- /no_skip: cancel one skip day
- /checkin: checkin now
- /schedule: trigger the schedule event

To update your location, send a location to this bot.

The bot responds to every valid command with the current stored information about current user in JSON format.
`;

async function login(username: string, password: string): Promise<string> {
    const result = await fetch(login_url, {
        method: 'POST',
        headers:{
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'User-Agent': randomUserAgent.getRandom(),
        },    
        body: new URLSearchParams({
            'username': username,
            'password': password,
        })
    });
    const resp = BuaaResp.decode(await result.json());
    if (isLeft(resp)) 
        throw new LoginError("Invalid Login Response");
    if (resp.right.e == 1) {
        throw new LoginError(`Login Failed ${resp.right.m}`);
    }
    const cookies = result.headers.get('set-cookie');
    if (cookies == undefined)
        throw new LoginError("set-cookie not found");
    return cookies;
}

async function send_message_to(env: Env, chat_id: number, msg: string, markdown: boolean): Promise<void> {
    const resp = await fetch(telegram_bot_url + env.TelegramToken + "/" + "sendMessage", {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            chat_id: chat_id.toString(), 
            parse_mode: markdown ? "MarkdownV2" : "", 
            text: msg,
        }),
    });
    if (!resp.ok) {
        console.error("send telegram message failed: " + await resp.text());
    }
}

async function checkin(env: Env, info: t.TypeOf<typeof UserInfo>) {
    const cookies = await login(info.username, info.password);
    const res = await fetch(gaode_url + "?" + new URLSearchParams({
        key: env.GaodeToken,
        location: `${info.location.longitude},${info.location.latitude}`,
    }));
    const j: any = await res.json();
    const checkin_form = new URLSearchParams({
        'brsfzc': '1', 'tw': '', 'sfcxzz': '', 'zdjg': '', 'zdjg_other': '', 'sfgl': '', 'gldd': '',
        'gldd_other': '', 'glyy': '', 'glyy_other': '', 'gl_start': '', 'gl_end': '', 'sfmqjc': '', 'sfzc_14': '1', 'sfqw_14': '0', 'sfqw_14_remark': '',
        'sfzgfx': '0', 'sfzgfx_remark': '', 'sfjc_14': '0', 'sfjc_14_remark': '', 'sfjcqz_14': '0', 'sfjcqz_14_remark': '', 'sfgtjz_14': '0',
        'sfgtjz_14_remark': '', 'szsqqz': '0', 'sfyqk': '', 'szdd': '1', 'area': info.area, 'city': info.city, 'province': info.province,
        'address': info.address, 'geo_api_info': JSON.stringify(j["regeocode"]), 'gwdz': '', 'is_move': '0', 'move_reason': '', 'move_remark': '',
    });
    if (info.in_campus) {
        checkin_form.append('sfzs', '1');
        checkin_form.append('bzxyy', '2');
        checkin_form.append('bzxyy_other', '');
    } else {
        checkin_form.append('sfzs', '0');
        checkin_form.append('bzxyy', '2');
        checkin_form.append('bzxyy_other', '');
    }
    const result = await fetch(checkin_url, {
        method: 'POST',
        headers: {
            'User-Agent': randomUserAgent.getRandom(),
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cookie': cookies,
        },
        body: checkin_form,
    });
    const text = await result.text();
    try {
        const json = JSON.parse(text);
        const resp = BuaaResp.decode(json);
        if (isLeft(resp))
            throw new Error(`Invalid CheckIn Resp ${JSON.stringify(json)}`);
        await send_message_to(env, info.chat_id, resp.right.m, false);
    } catch (e: unknown) {
        if (e instanceof SyntaxError) {
            await send_message_to(env, info.chat_id, "checkin failed: resp is not JSON", false);
            return;
        }
        throw e;
    }
} 

const TelegramUpdate = t.type({
    message: t.intersection([t.type({
        chat: t.type({
            id: t.number,
        }),
    }), t.partial({
        location: TelegramMessageLocation,
        text: t.string,
    })]),
});

async function info_of(env: Env, id: number): Promise<t.TypeOf<typeof UserInfo>> {
    const key = `user:${id}`;
    const value = await env.kv.get(key);
    if (value == null)
        throw new UserNotFound(id);
    const json = JSON.parse(value);
    const result = UserInfo.decode(json);
    if (isLeft(result))
        throw new InvalidUserInfo(json);
    const info = result.right;
    return info;
}

async function check_with_user(env: Env, id: number) {
    const info = await info_of(env, id);
    await send_message_to(env, info.chat_id, 
                          `\`\`\`json\n${JSON.stringify(info, null, 2)}\n\`\`\``,
                          true);
}

async function do_scheduled(env: Env) {
    const d: Date = new Date();
    const hh = (d.getUTCHours() + 8) % 24;
    const mm = d.getUTCMinutes();
    const users = [];
    let cursor: string | null = null;
    while (true) {
        const value = await env.kv.list({ prefix: "user:", cursor: cursor });
        for (const key of value.keys) {
            const id = +key.name.split(":")[1];
            try {
                const info = await info_of(env, id);
                const current_minutes = hh * 60 + mm;
                const expected_minutes = info.hh * 60 + info.mm;
                if (Math.abs(expected_minutes - current_minutes) > 10) {
                    continue;
                }
                if (info.skip > 0) {
                    info.skip -= 1;
                    await env.kv.put(`user:${id}`, JSON.stringify(info));
                    await send_message_to(env, info.chat_id, `skip for today`, false);
                    await check_with_user(env, info.chat_id);
                }
                users.push(info);
            } catch (e: unknown) {
                if (e instanceof UserNotFound) {
                    console.error(`User not found for id ${e.id}`);
                    return;
                }
                throw e;
            }
        }
        if (value.list_complete)
            break;
        cursor = value.cursor as string;
    }
    console.log(`schedule for ${users.length} users`);
    for (let user of users) {
        await checkin(env, user);
    }
}

export default {
    async scheduled(
        controller: ScheduledController,
        env: Env,
        ctx: ExecutionContext
    ): Promise<void> {
        await do_scheduled(env);
    },

    async fetch(
        request: Request,
        env: Env,
        ctx: ExecutionContext
    ): Promise<Response> {
        try {
            const text = await request.text();
            const json: object = JSON.parse(text);
            const result = TelegramUpdate.decode(json);
            if (isLeft(result))
                throw new NotTelegramUpdateError(json);
            const update = result.right;
            try {
                if (update.message.text != undefined) {
                    if (update.message.text.startsWith("/start")) {
                        await send_message_to(env, update.message.chat.id, help, false);
                    } else if (update.message.text.startsWith("/login ")) {
                        const args = update.message.text.split(" ");
                        if (args.length != 3) {
                            throw new WrongCommandError(update.message.text);
                        }
                        const _ = await login(args[1], args[2]);
                        const key = `user:${update.message.chat.id}`;
                        await env.kv.put(key, JSON.stringify({
                            username: args[1],
                            password: args[2],
                            chat_id: update.message.chat.id,
                            hh: 17,
                            mm: 30,
                            skip: 0,
                            province: "北京市",
                            city: "北京市",
                            area: "北京市 海淀区",
                            address: "北京市海淀区花园路街道北京航空航天大学大运村学生公寓",
                            in_campus: true,
                            location: {
                                longitude: 116.343699,
                                latitude: 39.977847,
                            }
                        }));
                        await check_with_user(env, update.message.chat.id);
                    } else if (update.message.text.startsWith("/checkin_at ")) {
                        const args = update.message.text.split(" ");
                        if (args.length != 2) {
                            throw new WrongCommandError(update.message.text);
                        }
                        const parts = args[1].split(":");
                        if (parts.length != 2) {
                            throw new WrongCheckinTime(args[1]);
                        }
                        const hh = checkin_hh.decode(+parts[0]);
                        const mm = checkin_mm.decode(+parts[1]);
                        if (isLeft(hh) || isLeft(mm))
                            throw new WrongCheckinTime(args[1]);
                        const info = await info_of(env, update.message.chat.id);
                        info.hh = hh.right;
                        info.mm = mm.right;
                        await env.kv.put(`user:${update.message.chat.id}`, JSON.stringify(info));
                        await check_with_user(env, update.message.chat.id);
                    } else if (update.message.text.startsWith("/info")) {
                        const d: Date = new Date();
                        const hh = (d.getUTCHours() + 8) % 24;
                        const mm = d.getUTCMinutes();
                        await send_message_to(env, update.message.chat.id, `Current Time: ${hh}:${mm}`, false);
                        await check_with_user(env, update.message.chat.id);
                    } else if (update.message.text.startsWith("/skip")) {
                        const info = await info_of(env, update.message.chat.id);
                        info.skip += 1;
                        await env.kv.put(`user:${update.message.chat.id}`, JSON.stringify(info));
                        await check_with_user(env, update.message.chat.id);
                    } else if (update.message.text.startsWith("/no_skip")) {
                        const info = await info_of(env, update.message.chat.id);
                        if (info.skip > 0) {
                            info.skip -= 1;
                        }
                        await env.kv.put(`user:${update.message.chat.id}`, JSON.stringify(info));
                        await check_with_user(env, update.message.chat.id);
                    } else if (update.message.text.startsWith("/checkin"))  {
                        const info = await info_of(env, update.message.chat.id);
                        await checkin(env, info);
                    } else if (update.message.text.startsWith("/delete")) {
                        await env.kv.delete(`user:${update.message.chat.id}`);
                        await check_with_user(env, update.message.chat.id);
                    } else if (update.message.text.startsWith("/in_campus")) {
                        const info = await info_of(env, update.message.chat.id);
                        info.in_campus = true;
                        await env.kv.put(`user:${update.message.chat.id}`, JSON.stringify(info));
                        await check_with_user(env, update.message.chat.id);
                    } else if (update.message.text.startsWith("/out_of_campus")) {
                        const info = await info_of(env, update.message.chat.id);
                        info.in_campus = false;
                        await env.kv.put(`user:${update.message.chat.id}`, JSON.stringify(info));
                        await check_with_user(env, update.message.chat.id);
                    } else if (update.message.text.startsWith("/schedule")) {
                        await do_scheduled(env);
                    } else {
                        throw new WrongCommandError(update.message.text);
                    }
                } else if (update.message.location != undefined) {
                    const loc = update.message.location as t.TypeOf<typeof TelegramMessageLocation>;
                    const result = await fetch(gaode_url + "?" + new URLSearchParams({
                        key: env.GaodeToken,
                        location: `${loc.longitude},${loc.latitude}`,
                    }));
                    const json: object = await result.json();
                    const resp = GaodeResp.decode(json);
                    if (isLeft(resp)) {
                        throw new InvalidGaodeResp(json);
                    }
                    const province = resp.right.regeocode.addressComponent.province;
                    const city = typeof resp.right.regeocode.addressComponent.city == "string" ? resp.right.regeocode.addressComponent.city as string : province;
                    const district = resp.right.regeocode.addressComponent.district;
                    const area = city + " " + district;
                    const address = resp.right.regeocode.formatted_address;
                    const info = await info_of(env, update.message.chat.id);
                    info.city = city;
                    info.province = province;
                    info.area = area;
                    info.address = address;
                    info.location = loc;
                    await env.kv.put(`user:${update.message.chat.id}`, JSON.stringify(info));
                    await check_with_user(env, update.message.chat.id);
                }
            } catch (e: unknown) {
                if (e instanceof WrongCommandError) {
                    await send_message_to(env, update.message.chat.id, `Invalid command: ${e.command}` + '\n' + help, false);
                    return new Response("end with error");
                }
                if (e instanceof LoginError) {
                    await send_message_to(env, update.message.chat.id, e.message, false);
                    return new Response("end with error");
                }
                if (e instanceof WrongCheckinTime) {
                    await send_message_to(env, update.message.chat.id, `Wrong checkin time: ${e.checkin_time}, hours should between 16 and 19, minutes shoud be 0 or 30.`, false);
                    return new Response("end with error");
                }
                if (e instanceof UserNotFound) {
                    await send_message_to(env, update.message.chat.id, `User ${update.message.chat.id} does not exist`, false);
                    return new Response("end with error");
                }
                throw e;
            }
        } catch (e: unknown) {
            if (e instanceof NotTelegramUpdateError) {
                const msg = `Request JSON is not a Telegram Update: \n${JSON.stringify(e.json)}`;
                console.error(msg);
                return new Response("end with error");
            }
            if (e instanceof UserNotFound) {
                const msg = `User not found with id ${e.id}`;
                console.error(msg);
                return new Response("end with error");
            }
            if (e instanceof InvalidUserInfo) {
                console.error(JSON.stringify(e.json));
                return new Response("end with error");
            }
            if (e instanceof SyntaxError) {
                console.log(`${e.message}`);
                return new Response("end with error");
            }
            throw e;
        }
        return new Response("Success");
    },
};
