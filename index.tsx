import { definePluginSettings } from "@api/Settings";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Menu } from "@webpack/common";
import definePlugin, { OptionType } from "@utils/types";
import { UserStore, GuildMemberStore } from "@webpack/common";
import {
    openModal,
    ModalRoot,
    ModalHeader,
    ModalContent,
    ModalFooter,
    ModalSize,
    ModalCloseButton,
} from "@utils/modal";
import { Button, Forms } from "@webpack/common";

const LIST_URL = "https://x7m2k9q-api.goofygoober123g.workers.dev/";

const NAME_POOL = [
    "Eliran Goonerberg",
    "Schlomo Coomerstein",
    "Moishe Cummelbaum",
    "Yossi Goonblatt",
    "Avi Schlongowitz",
    "Dudu Coomerman",
    "Itzik Goonfeld",
    "Benzi Schmeckelstein",
    "Naftali Coomberg",
    "Chaim Goonowitz",
    "Mordechai Cumelbach",
    "Shimon Schlongberg",
    "Eli Goonerthal",
    "Meir Coomerovsky",
    "Yehuda Goonheim",
    "Ariel Schmendrikstein",
    "Tzvi Coomelzon",
    "Gilad Goonblum",
    "Shai Cumshteyn",
    "Raffi Goonerbach",
];

const EMOJI_START = "⚠️";
const EMOJI_END = "⚠️";

const settings = definePluginSettings({
    autoMark: {
        type: OptionType.BOOLEAN,
        description: "Automatically modify display names for entries in the registry. When off, only the right-click 'Check the registry' option is available.",
        default: false,
        restartNeeded: true,
    },
});

let targetIds: Set<string> = new Set();
const patchedUsers = new WeakSet<object>();
const nameAssignments = new Map<string, string>();

let memberStoreProto: any = null;
let originalGetNick: any = null;
let originalGetMember: any = null;
let originalGetTrueMember: any = null;

function hashIdToIndex(id: string, poolSize: number): number {
    let hash = 5381;
    for (let i = 0; i < id.length; i++) {
        hash = ((hash << 5) + hash + id.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % poolSize;
}

function getAssignedName(userId: string): string {
    const cached = nameAssignments.get(userId);
    if (cached) return cached;
    const idx = hashIdToIndex(userId, NAME_POOL.length);
    const name = `${EMOJI_START} ${NAME_POOL[idx]} ${EMOJI_END}`;
    nameAssignments.set(userId, name);
    return name;
}

function parseIdList(raw: string): string[] {
    const out: string[] = [];
    for (const token of raw.split(/[\s,]+/)) {
        const cleaned = token.trim();
        if (/^\d{17,20}$/.test(cleaned)) {
            out.push(cleaned);
        }
    }
    return out;
}

async function loadIds() {
    try {
        const res = await fetch(LIST_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const ids = parseIdList(text);
        targetIds = new Set(ids);
        if (settings.store.autoMark) {
            applyToCachedUsers();
        }
    } catch (e) {
        targetIds = new Set();
    }
}

function patchUser(user: any) {
    if (!user || !targetIds.has(user.id)) return;
    if (patchedUsers.has(user)) return;

    try {
        const userId = user.id;
        const getReplacement = () => getAssignedName(userId);

        Object.defineProperty(user, "__origGN", {
            value: user.globalName, writable: true, enumerable: false, configurable: true,
        });

        Object.defineProperty(user, "globalName", {
            get: getReplacement,
            set(v) { (user as any).__origGN = v; },
            enumerable: true,
            configurable: true,
        });

        patchedUsers.add(user);
    } catch { }
}

function applyToCachedUsers() {
    try {
        const users = (UserStore as any).getUsers?.() ?? {};
        for (const id of targetIds) {
            const u = users[id];
            if (u) patchUser(u);
        }
    } catch { }
}

function patchMemberStore() {
    try {
        memberStoreProto = Object.getPrototypeOf(GuildMemberStore);
        if (!memberStoreProto) return;

        if (typeof memberStoreProto.getNick === "function") {
            originalGetNick = memberStoreProto.getNick;
            memberStoreProto.getNick = function (guildId: string, userId: string) {
                if (userId && targetIds.has(userId)) return null;
                return originalGetNick.call(this, guildId, userId);
            };
        }

        if (typeof memberStoreProto.getMember === "function") {
            originalGetMember = memberStoreProto.getMember;
            memberStoreProto.getMember = function (guildId: string, userId: string) {
                const result = originalGetMember.call(this, guildId, userId);
                if (result && userId && targetIds.has(userId)) {
                    return { ...result, nick: null };
                }
                return result;
            };
        }

        if (typeof memberStoreProto.getTrueMember === "function") {
            originalGetTrueMember = memberStoreProto.getTrueMember;
            memberStoreProto.getTrueMember = function (guildId: string, userId: string) {
                const result = originalGetTrueMember.call(this, guildId, userId);
                if (result && userId && targetIds.has(userId)) {
                    return { ...result, nick: null };
                }
                return result;
            };
        }
    } catch { }
}

function unpatchMemberStore() {
    try {
        if (memberStoreProto) {
            if (originalGetNick) memberStoreProto.getNick = originalGetNick;
            if (originalGetMember) memberStoreProto.getMember = originalGetMember;
            if (originalGetTrueMember) memberStoreProto.getTrueMember = originalGetTrueMember;
        }
    } catch { }
    memberStoreProto = null;
    originalGetNick = null;
    originalGetMember = null;
    originalGetTrueMember = null;
}

function openRegistryCheckModal(user: any) {
    const inRegistry = targetIds.has(user.id);
    const displayName = user.globalName || user.username || user.id;

    openModal(props => (
        <ModalRoot {...props} size={ModalSize.DYNAMIC}>
            <ModalHeader separator={false} style={{ padding: "16px 16px 8px 16px" }}>
                <Forms.FormTitle tag="h2" style={{ flex: 1, margin: 0 }}>
                    Registry Check
                </Forms.FormTitle>
                <ModalCloseButton onClick={props.onClose} />
            </ModalHeader>

            <ModalContent style={{ padding: "0 16px 16px 16px" }}>
                <div style={{
                    width: "320px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    textAlign: "center",
                    gap: "6px",
                    paddingTop: "4px",
                }}>
                    <Forms.FormText style={{ fontSize: "14px", fontWeight: 500 }}>
                        {displayName}
                    </Forms.FormText>
                    <Forms.FormText style={{ opacity: 0.5, fontSize: "11px", marginBottom: "8px" }}>
                        {user.id}
                    </Forms.FormText>
                    {inRegistry ? (
                        <Forms.FormText style={{
                            fontSize: "16px",
                            fontWeight: 600,
                            color: "var(--status-danger)",
                        }}>
                            ⚠️ In the registry ⚠️
                        </Forms.FormText>
                    ) : (
                        <Forms.FormText style={{
                            fontSize: "16px",
                            fontWeight: 600,
                            color: "var(--status-positive)",
                        }}>
                            ✓ Not in the registry
                        </Forms.FormText>
                    )}
                </div>
            </ModalContent>

            <ModalFooter separator={false} style={{ padding: "8px 16px 16px 16px", justifyContent: "center" }}>
                <Button onClick={props.onClose} size={Button.Sizes.SMALL}>Close</Button>
            </ModalFooter>
        </ModalRoot>
    ));
}

const userContextPatch: NavContextMenuPatchCallback = (children, { user }: { user: any }) => {
    if (!user) return;

    children.push(
        <Menu.MenuItem
            id="spotted-check-registry"
            label="Check the registry"
            action={() => openRegistryCheckModal(user)}
        />
    );
};

export default definePlugin({
    name: "Spotted",
    description: "Local display name adjustments",
    authors: [{ name: "anon", id: 0n }],
    settings,

    contextMenus: {
        "user-context": userContextPatch,
    },

    flux: {
        USER_UPDATE({ user }: any) {
            if (!settings.store.autoMark) return;
            if (user?.id && targetIds.has(user.id)) {
                const storeUser = (UserStore as any).getUser?.(user.id);
                if (storeUser) patchUser(storeUser);
                patchUser(user);
            }
        },
        USER_PROFILE_FETCH_SUCCESS({ user }: any) {
            if (!settings.store.autoMark) return;
            if (user?.id && targetIds.has(user.id)) {
                patchUser(user);
                const storeUser = (UserStore as any).getUser?.(user.id);
                if (storeUser) patchUser(storeUser);
            }
        },
        GUILD_MEMBERS_CHUNK({ members }: any) {
            if (!settings.store.autoMark) return;
            if (!members) return;
            for (const m of members) {
                if (m?.user?.id && targetIds.has(m.user.id)) {
                    patchUser(m.user);
                    const storeUser = (UserStore as any).getUser?.(m.user.id);
                    if (storeUser) patchUser(storeUser);
                }
            }
        },
        MESSAGE_CREATE({ message }: any) {
            if (!settings.store.autoMark) return;
            if (message?.author?.id && targetIds.has(message.author.id)) {
                patchUser(message.author);
                const storeUser = (UserStore as any).getUser?.(message.author.id);
                if (storeUser) patchUser(storeUser);
            }
        },
        MESSAGE_UPDATE({ message }: any) {
            if (!settings.store.autoMark) return;
            if (message?.author?.id && targetIds.has(message.author.id)) {
                patchUser(message.author);
                const storeUser = (UserStore as any).getUser?.(message.author.id);
                if (storeUser) patchUser(storeUser);
            }
        },
        LOAD_MESSAGES_SUCCESS({ messages }: any) {
            if (!settings.store.autoMark) return;
            if (targetIds.size === 0 || !messages) return;
            for (const msg of messages) {
                if (msg?.author?.id && targetIds.has(msg.author.id)) {
                    patchUser(msg.author);
                    const storeUser = (UserStore as any).getUser?.(msg.author.id);
                    if (storeUser) patchUser(storeUser);
                }
            }
        },
    },

    async start() {
        await loadIds();
        if (settings.store.autoMark) {
            patchMemberStore();
        }
    },

    stop() {
        unpatchMemberStore();
        targetIds.clear();
        nameAssignments.clear();
    },
});
