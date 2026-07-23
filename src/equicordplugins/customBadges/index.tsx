/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BadgePosition, ProfileBadge } from "@api/Badges";
import { EquicordDevs } from "@utils/constants";
import definePlugin from "@utils/types";

const USER_ID = "241671871509168129";

const Badges: ProfileBadge[] = [
    {
        id: "jahbas_look_left",
        description: "Look Left",
        iconSrc: "https://badge.equicord.org/badges/848339671629299742/fa8e0e1d6bfe16f32ca2ba7937bf0ec1b3cf2e07.webp",
        position: BadgePosition.START,
        shouldShow: ({ userId }) => userId === USER_ID,
        props: { style: { borderRadius: "50%", transform: "scale(0.9)" } },
    },
    {
        id: "jahbas_around_world",
        description: "Around the world",
        iconSrc: "https://badges.vencord.dev/badges/848339671629299742/1-8d2f71fa61e73298c5f12644943d2ce59a22f6f7.gif",
        position: BadgePosition.START,
        shouldShow: ({ userId }) => userId === USER_ID,
        props: { style: { borderRadius: "50%", transform: "scale(0.9)" } },
    },
    {
        id: "jahbas_look_right",
        description: "Look Right",
        iconSrc: "https://badge.equicord.org/badges/848339671629299742/6655581d88f729dde37bf0277ca95f4653f33e59.webp",
        position: BadgePosition.START,
        shouldShow: ({ userId }) => userId === USER_ID,
        props: { style: { borderRadius: "50%", transform: "scale(0.9)" } },
    },
];

export default definePlugin({
    name: "CustomBadges",
    description: "Custom badges for Jahbas",
    authors: [EquicordDevs.Jahbas],
    enabledByDefault: true,
    userProfileBadges: Badges,
});
