package com.tabsync.nowplaying

import android.service.notification.NotificationListenerService

/**
 * Intentionally empty. Its only job is to exist, so Android lets the user grant
 * this app notification access, which is required to read other apps' media
 * sessions through MediaSessionManager.
 */
class NowPlayingListenerService : NotificationListenerService()
