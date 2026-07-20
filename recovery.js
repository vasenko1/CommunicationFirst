export const RECOVERY_ACTIONS = {
    NONE: "none",
    START_ICE_RESTART: "start-ice-restart",
    GIVE_UP: "give-up"
};

export class RecoveryController {
    onPeerState(state) {
        if (state === "disconnected" || state === "failed") {
            return RECOVERY_ACTIONS.START_ICE_RESTART;
        }

        return RECOVERY_ACTIONS.NONE;
    }

    onPeerReady(callState) {
        if (callState === "reconnecting") {
            return RECOVERY_ACTIONS.START_ICE_RESTART;
        }

        return RECOVERY_ACTIONS.NONE;
    }
}