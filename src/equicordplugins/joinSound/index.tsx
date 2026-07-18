/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { playAudio } from "@api/AudioPlayer";
import { definePluginSettings } from "@api/Settings";
import { useForceUpdater } from "@utils/react";
import definePlugin, { OptionType } from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import { Button, Constants, GuildStore, Modal, openModal, React, RelationshipStore, RestAPI, SearchableSelect, SelectedChannelStore, TextInput, Toasts, UserStore } from "@webpack/common";

interface WatchEntry {
    userId: string;
    soundType: "none" | "soundboard" | "custom";
    soundId?: string;
    guildId?: string;
    customUrl?: string;
}

const inMyChannel = new Set<string>();

function getWatched(): WatchEntry[] {
    try {
        const raw = settings.store.watchedUsers;
        if (!raw) return [];
        return JSON.parse(raw as string);
    } catch { return []; }
}

function saveWatched(users: WatchEntry[]) {
    settings.store.watchedUsers = JSON.stringify(users);
}

async function playSound(entry: WatchEntry, voiceChannelId: string) {
    if (entry.soundType === "soundboard" && entry.soundId && entry.guildId) {
        try {
            await RestAPI.post({
                url: Constants.Endpoints.SEND_SOUNDBOARD_SOUND(voiceChannelId),
                body: {
                    sound_id: entry.soundId,
                    source_guild_id: entry.guildId,
                }
            });
        } catch {
            Toasts.show({
                message: "JoinSound: failed to play soundboard sound.",
                id: Toasts.genId(),
                type: Toasts.Type.FAILURE
            });
        }
    } else if (entry.soundType === "custom" && entry.customUrl) {
        playAudio(entry.customUrl, { volume: settings.store.volume });
    }
}

function GuildSelect({ value, onChange }: { value?: string; onChange: (v: string) => void; }) {
    const options = Object.values(GuildStore.getGuilds()).map(g => ({
        value: g.id, label: g.name
    }));
    return (
        <SearchableSelect
            options={options}
            value={options.find(o => o.value === value)?.value}
            placeholder="Pick server..."
            maxVisibleItems={6}
            closeOnSelect={true}
            onChange={onChange}
        />
    );
}

function openFriendPicker(onSelect: (id: string) => void) {
    const friendIds = RelationshipStore.getFriendIDs();
    const Wrapper = (props: RenderModalProps) => {
        const [search, setSearch] = React.useState("");
        const q = search.toLowerCase();
        const filtered = search
            ? friendIds.filter(id => {
                const u = UserStore.getUser(id);
                return u && (u.username.toLowerCase().includes(q)
                    || u.globalName?.toLowerCase().includes(q)
                    || id.includes(q));
            })
            : friendIds;

        return (
            <Modal {...props} size="md" title="Select a Friend">
                <div style={{ padding: "0 16px", marginBottom: 8, marginTop: 8 }}>
                    <TextInput value={search} onChange={setSearch} placeholder="Search friends..." />
                </div>
                <div style={{ maxHeight: 400, overflowY: "auto", padding: "0 0 16px" }}>
                    {filtered.length === 0 ? (
                        <div style={{ padding: 16, textAlign: "center", color: "var(--text-muted)" }}>
                            No friends found
                        </div>
                    ) : filtered.map(id => {
                        const user = UserStore.getUser(id);
                        if (!user) return null;
                        return (
                            <div
                                key={id}
                                onClick={() => { onSelect(id); props.onClose(); }}
                                style={{
                                    display: "flex", alignItems: "center", gap: 8,
                                    padding: "8px 16px", cursor: "pointer", borderRadius: 4,
                                }}
                                onMouseEnter={e => (e.currentTarget.style.background = "var(--background-modifier-hover)")}
                                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                            >
                                <img
                                    src={user.getAvatarURL(null, 32)}
                                    style={{ width: 28, height: 28, borderRadius: "50%" }}
                                    alt=""
                                />
                                <div>
                                    <div>{user.username}</div>
                                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{user.id}</div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </Modal>
        );
    };
    openModal(props => <Wrapper {...props} />);
}

function JoinSoundSettings() {
    const update = useForceUpdater();
    const [users, setUsers] = React.useState<WatchEntry[]>(() => getWatched());
    const [uidInput, setUidInput] = React.useState("");

    function persist(newUsers: WatchEntry[]) {
        setUsers(newUsers);
        saveWatched(newUsers);
        update();
    }

    function updateEntry(i: number, e: WatchEntry) {
        const next = [...users];
        next[i] = e;
        persist(next);
    }

    function removeEntry(i: number) {
        persist(users.filter((_, idx) => idx !== i));
    }

    function addUser(userId: string) {
        if (!userId || users.some(u => u.userId === userId)) return;
        persist([...users, { userId, soundType: "none" }]);
    }

    const soundTypeOpts = [
        { label: "None", value: "none", default: true },
        { label: "Soundboard", value: "soundboard" },
        { label: "Custom URL", value: "custom" },
    ];

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "8px 0" }}>
            <div style={{ display: "flex", gap: 4 }}>
                <TextInput
                    value={uidInput}
                    onChange={setUidInput}
                    placeholder="Paste user ID..."
                />
                <Button
                    size={Button.Sizes.MIN}
                    onClick={() => { addUser(uidInput.trim()); setUidInput(""); }}
                    disabled={!uidInput.trim()}
                >
                    Add
                </Button>
                <Button size={Button.Sizes.MIN} onClick={() => openFriendPicker(addUser)}>
                    Friend
                </Button>
            </div>

            {users.map((entry, i) => {
                const user = UserStore.getUser(entry.userId);
                return (
                    <div key={entry.userId} style={{
                        padding: 12, border: "1px solid var(--background-modifier-accent)",
                        borderRadius: 8, display: "flex", flexDirection: "column", gap: 8,
                    }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                {user && (
                                    <img
                                        src={user.getAvatarURL(null, 28)}
                                        style={{ width: 28, height: 28, borderRadius: "50%" }}
                                        alt=""
                                    />
                                )}
                                <div>
                                    <div>{user?.username ?? entry.userId}</div>
                                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{entry.userId}</div>
                                </div>
                            </div>
                            <Button size={Button.Sizes.MIN} color={Button.Colors.RED} onClick={() => removeEntry(i)}>
                                Remove
                            </Button>
                        </div>

                        <SearchableSelect
                            options={soundTypeOpts}
                            value={soundTypeOpts.find(o => o.value === entry.soundType)?.value}
                            placeholder="Sound type..."
                            maxVisibleItems={3}
                            closeOnSelect={true}
                            onChange={v => {
                                entry.soundType = v as WatchEntry["soundType"];
                                updateEntry(i, { ...entry });
                            }}
                        />

                        {entry.soundType === "soundboard" && (
                            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                                <GuildSelect
                                    value={entry.guildId}
                                    onChange={v => {
                                        entry.guildId = v;
                                        updateEntry(i, { ...entry });
                                    }}
                                />
                                <TextInput
                                    value={entry.soundId ?? ""}
                                    onChange={v => {
                                        entry.soundId = v;
                                        updateEntry(i, { ...entry });
                                    }}
                                    placeholder="Sound ID"
                                />
                                <Button
                                    size={Button.Sizes.MIN}
                                    onClick={() => {
                                        if (entry.soundId)
                                            playAudio(`https://cdn.discordapp.com/soundboard-sounds/${entry.soundId}`, { volume: settings.store.volume });
                                    }}
                                    disabled={!entry.soundId}
                                >
                                    ▶
                                </Button>
                            </div>
                        )}

                        {entry.soundType === "custom" && (
                            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                                <TextInput
                                    value={entry.customUrl ?? ""}
                                    onChange={v => {
                                        entry.customUrl = v;
                                        updateEntry(i, { ...entry });
                                    }}
                                    placeholder="https://..."
                                />
                                <Button
                                    size={Button.Sizes.MIN}
                                    onClick={() => {
                                        if (entry.customUrl)
                                            playAudio(entry.customUrl, { volume: settings.store.volume });
                                    }}
                                    disabled={!entry.customUrl}
                                >
                                    ▶
                                </Button>
                            </div>
                        )}
                    </div>
                );
            })}

            {users.length === 0 && (
                <div style={{ padding: 16, textAlign: "center", color: "var(--text-muted)" }}>
                    No users added. Add a friend or paste a user ID.
                </div>
            )}
        </div>
    );
}

const settings = definePluginSettings({
    volume: {
        type: OptionType.SLIDER,
        description: "Volume for locally-played sounds (custom URLs only)",
        default: 70,
        markers: [0, 25, 50, 75, 100],
    },
    delay: {
        type: OptionType.SLIDER,
        description: "Delay before playing (ms)",
        default: 0,
        markers: [0, 500, 1000, 2000, 3000],
    },
    watchedUsers: {
        type: OptionType.STRING,
        description: "Serialized watched users",
        default: "[]",
        hidden: true,
    },
});

export default definePlugin({
    name: "JoinSound",
    description: "Play a sound when selected friends/users join your voice channel.",
    authors: [{ name: "dckrzw", id: 241671871509168129n }],
    tags: ["Fun", "Voice", "Friends"],
    dependencies: ["AudioPlayerAPI"],
    settings,
    settingsAboutComponent: JoinSoundSettings,

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: any[] }) {
            const myChannelId = SelectedChannelStore.getVoiceChannelId();
            if (!myChannelId) return;

            const me = UserStore.getCurrentUser().id;
            const watched = getWatched();
            if (!watched.length) return;

            const delay = settings.store.delay;

            for (const state of voiceStates) {
                const { userId, channelId } = state;
                if (userId === me) continue;

                const wasInChannel = inMyChannel.has(userId);
                const isInChannel = channelId === myChannelId;

                if (isInChannel) inMyChannel.add(userId);
                else inMyChannel.delete(userId);

                if (wasInChannel || !isInChannel) continue;

                const entry = watched.find(w => w.userId === userId);
                if (!entry || entry.soundType === "none") continue;

                if (delay > 0) {
                    setTimeout(() => playSound(entry, myChannelId), delay);
                } else {
                    playSound(entry, myChannelId);
                }
            }
        },
    },
});
