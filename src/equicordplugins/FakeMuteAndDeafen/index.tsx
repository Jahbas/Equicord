/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { UserAreaButton, UserAreaRenderProps } from "@api/UserArea";
import { EquicordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findComponentByCodeLazy, findByPropsLazy } from "@webpack";
import { React } from "@webpack/common";

const MediaEngineActions = findByPropsLazy("toggleSelfMute");
const NotificationSettingsStore = findByPropsLazy("getDisableAllSounds", "getState");

const MuteIcon = findComponentByCodeLazy('d:"m2.7 22.7 20-20a1', "1.4ZM10.8") as any;
const DeafIcon = findComponentByCodeLazy("M22.7 2.7a1", "1.4l20-20ZM17") as any;

const fakeVoiceState = {
    _selfMute: false,
    get selfMute() { return this.selfDeaf || this._selfMute; },
    set selfMute(v: boolean) { this._selfMute = v; },
    selfDeaf: false,
};

let updating = false;
async function triggerVoiceUpdate() {
    if (updating) return setTimeout(triggerVoiceUpdate, 125);
    updating = true;
    const state = NotificationSettingsStore.getState();
    const toDisable: string[] = [];
    if (!state.disabledSounds.includes("mute")) toDisable.push("mute");
    if (!state.disabledSounds.includes("unmute")) toDisable.push("unmute");
    state.disabledSounds.push(...toDisable);
    await new Promise(r => setTimeout(r, 50));
    await MediaEngineActions.toggleSelfMute();
    await new Promise(r => setTimeout(r, 100));
    await MediaEngineActions.toggleSelfMute();
    state.disabledSounds = state.disabledSounds.filter((i: string) => !toDisable.includes(i));
    updating = false;
}

export const settings = definePluginSettings({
    autoMute: {
        type: OptionType.BOOLEAN,
        description: "Automatically mute when Fake Deaf is enabled.",
        default: true,
    },
});

function FakeButtons({ iconForeground }: UserAreaRenderProps) {
    const [muted, setMuted] = React.useState(fakeVoiceState._selfMute);
    const [deafened, setDeafened] = React.useState(fakeVoiceState.selfDeaf);

    const toggleMute = () => {
        const next = !fakeVoiceState._selfMute;
        fakeVoiceState.selfMute = next;
        if (!next) fakeVoiceState.selfDeaf = false;
        setMuted(next);
        setDeafened(fakeVoiceState.selfDeaf);
        triggerVoiceUpdate();
    };

    const toggleDeaf = () => {
        const next = !fakeVoiceState.selfDeaf;
        fakeVoiceState.selfDeaf = next;
        if (next && settings.store.autoMute) fakeVoiceState.selfMute = true;
        setDeafened(next);
        setMuted(fakeVoiceState._selfMute);
        triggerVoiceUpdate();
    };

    return (
        <>
            <UserAreaButton
                tooltipText="Fake Mute"
                icon={<MuteIcon muted={muted} size="sm" className={iconForeground} />}
                role="switch"
                aria-checked={muted}
                redGlow={muted}
                onClick={toggleMute}
            />
            <UserAreaButton
                tooltipText="Fake Deaf"
                icon={<DeafIcon muted={deafened} size="sm" className={iconForeground} />}
                role="switch"
                aria-checked={deafened}
                redGlow={deafened}
                onClick={toggleDeaf}
            />
        </>
    );
}

export default definePlugin({
    name: "FakeMuteAndDeafen",
    description: "Appear muted/deafened to others while still hearing and speaking normally.",
    authors: [EquicordDevs.luka],
    settings,
    dependencies: ["UserAreaAPI"],

    userAreaButton: {
        icon: () => <MuteIcon muted={false} size="sm" />,
        render: FakeButtons,
    },

    patches: [
        {
            find: "voiceServerPing(){",
            replacement: {
                match: /voiceStateUpdate\((\w+)\){(.{0,10})guildId:/,
                replace: "voiceStateUpdate($1){$1=$self.modifyVoiceState($1);$2guildId:",
            },
        },
    ],

    modifyVoiceState(e: any) {
        e.selfMute = fakeVoiceState.selfMute || e.selfMute;
        e.selfDeaf = fakeVoiceState.selfDeaf || e.selfDeaf;
        return e;
    },
});
