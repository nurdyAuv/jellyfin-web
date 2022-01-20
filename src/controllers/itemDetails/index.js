import { intervalToDuration } from 'date-fns';
import { appHost } from '../../components/apphost';
import loading from '../../components/loading/loading';
import { appRouter } from '../../components/appRouter';
import layoutManager from '../../components/layoutManager';
import { Events } from 'jellyfin-apiclient';
import * as userSettings from '../../scripts/settings/userSettings';
import cardBuilder from '../../components/cardbuilder/cardBuilder';
import datetime from '../../scripts/datetime';
import mediaInfo from '../../components/mediainfo/mediainfo';
import backdrop from '../../components/backdrop/backdrop';
import listView from '../../components/listview/listview';
import itemContextMenu from '../../components/itemContextMenu';
import itemHelper from '../../components/itemHelper';
import dom from '../../scripts/dom';
import indicators from '../../components/indicators/indicators';
import imageLoader from '../../components/images/imageLoader';
import libraryMenu from '../../scripts/libraryMenu';
import globalize from '../../scripts/globalize';
import browser from '../../scripts/browser';
import { playbackManager } from '../../components/playback/playbackmanager';
import '../../assets/css/scrollstyles.scss';
import '../../elements/emby-itemscontainer/emby-itemscontainer';
import '../../elements/emby-checkbox/emby-checkbox';
import '../../elements/emby-button/emby-button';
import '../../elements/emby-playstatebutton/emby-playstatebutton';
import '../../elements/emby-ratingbutton/emby-ratingbutton';
import '../../elements/emby-scroller/emby-scroller';
import '../../elements/emby-select/emby-select';
import itemShortcuts from '../../components/shortcuts';
import Dashboard from '../../scripts/clientUtils';
import ServerConnections from '../../components/ServerConnections';
import confirm from '../../components/confirm/confirm';
import { download } from '../../scripts/fileDownloader';

function autoFocus(container) {
    import('../../components/autoFocuser').then(({ default: autoFocuser }) => {
        autoFocuser.autoFocus(container);
    });
}

function getPromise(apiClient, params) {
    const id = params.id;

    if (id) {
        return apiClient.getItem(apiClient.getCurrentUserId(), id);
    }

    if (params.seriesTimerId) {
        return apiClient.getLiveTvSeriesTimer(params.seriesTimerId);
    }

    if (params.genre) {
        return apiClient.getGenre(params.genre, apiClient.getCurrentUserId());
    }

    if (params.musicgenre) {
        return apiClient.getMusicGenre(params.musicgenre, apiClient.getCurrentUserId());
    }

    if (params.musicartist) {
        return apiClient.getArtist(params.musicartist, apiClient.getCurrentUserId());
    }

    throw new Error('Invalid request');
}

function hideAll(page, className, show) {
    for (const elem of page.querySelectorAll('.' + className)) {
        if (show) {
            elem.classList.remove('hide');
        } else {
            elem.classList.add('hide');
        }
    }
}

function getContextMenuOptions(item, user, button) {
    return {
        item: item,
        open: false,
        play: false,
        playAllFromHere: false,
        queueAllFromHere: false,
        positionTo: button,
        cancelTimer: false,
        record: false,
        deleteItem: item.CanDelete === true,
        shuffle: false,
        instantMix: false,
        user: user,
        share: true
    };
}

function getProgramScheduleHtml(items) {
    let html = '';

    html += '<div is="emby-itemscontainer" class="itemsContainer vertical-list" data-contextmenu="false">';
    html += listView.getListViewHtml({
        items: items,
        enableUserDataButtons: false,
        image: true,
        imageSource: 'channel',
        showProgramDateTime: true,
        showChannel: false,
        mediaInfo: false,
        action: 'none',
        moreButton: false,
        recordButton: false
    });

    html += '</div>';

    return html;
}

function renderSeriesTimerSchedule(page, apiClient, seriesTimerId) {
    apiClient.getLiveTvTimers({
        UserId: apiClient.getCurrentUserId(),
        ImageTypeLimit: 1,
        EnableImageTypes: 'Primary,Backdrop,Thumb',
        SortBy: 'StartDate',
        EnableTotalRecordCount: false,
        EnableUserData: false,
        SeriesTimerId: seriesTimerId,
        Fields: 'ChannelInfo,ChannelImage'
    }).then(function (result) {
        if (result.Items.length && result.Items[0].SeriesTimerId != seriesTimerId) {
            result.Items = [];
        }

        const html = getProgramScheduleHtml(result.Items);
        const scheduleTab = page.querySelector('.seriesTimerSchedule');
        scheduleTab.innerHTML = html;
        imageLoader.lazyChildren(scheduleTab);
    });
}

function renderTimerEditor(page, item, apiClient, user) {
    if (item.Type !== 'Recording' || !user.Policy.EnableLiveTvManagement || !item.TimerId || item.Status !== 'InProgress') {
        return void hideAll(page, 'btnCancelTimer');
    }

    hideAll(page, 'btnCancelTimer', true);
}

function renderSeriesTimerEditor(page, item, apiClient, user) {
    if (item.Type !== 'SeriesTimer') {
        return void hideAll(page, 'btnCancelSeriesTimer');
    }

    if (user.Policy.EnableLiveTvManagement) {
        import('../../components/recordingcreator/seriesrecordingeditor').then(({ default: seriesRecordingEditor }) => {
            seriesRecordingEditor.embed(item, apiClient.serverId(), {
                context: page.querySelector('.seriesRecordingEditor')
            });
        });

        page.querySelector('.seriesTimerScheduleSection').classList.remove('hide');
        hideAll(page, 'btnCancelSeriesTimer', true);
        return void renderSeriesTimerSchedule(page, apiClient, item.Id);
    }

    page.querySelector('.seriesTimerScheduleSection').classList.add('hide');
    return void hideAll(page, 'btnCancelSeriesTimer');
}

function renderTrackSelections(page, instance, item, forceReload) {
    const select = page.querySelector('.selectSource');

    if (!item.MediaSources || !itemHelper.supportsMediaSourceSelection(item) || playbackManager.getSupportedCommands().indexOf('PlayMediaSource') === -1 || !playbackManager.canPlay(item)) {
        page.querySelector('.trackSelections').classList.add('hide');
        select.innerHTML = '';
        page.querySelector('.selectVideo').innerHTML = '';
        page.querySelector('.selectAudio').innerHTML = '';
        page.querySelector('.selectSubtitles').innerHTML = '';
        return;
    }

    let mediaSources = item.MediaSources;

    const resolutionNames = [];
    const sourceNames = [];
    mediaSources.forEach(function (v) {
        (v.Name.endsWith('p') || v.Name.endsWith('i')) && !Number.isNaN(parseInt(v.Name, 10)) ? resolutionNames.push(v) : sourceNames.push(v);
    });

    resolutionNames.sort((a, b) => parseInt(b.Name, 10) - parseInt(a.Name, 10));
    sourceNames.sort(function(a, b) {
        const nameA = a.Name.toUpperCase();
        const nameB = b.Name.toUpperCase();
        if (nameA < nameB) {
            return -1;
        } else if (nameA > nameB) {
            return 1;
        }
        return 0;
    });

    mediaSources = [];
    resolutionNames.forEach(v => mediaSources.push(v));
    sourceNames.forEach(v => mediaSources.push(v));

    instance._currentPlaybackMediaSources = mediaSources;

    page.querySelector('.trackSelections').classList.remove('hide');
    select.setLabel(globalize.translate('LabelVersion'));

    const currentValue = select.value;

    const selectedId = mediaSources[0].Id;
    select.innerHTML = mediaSources.map(function (v) {
        const selected = v.Id === selectedId ? ' selected' : '';
        return '<option value="' + v.Id + '"' + selected + '>' + v.Name + '</option>';
    }).join('');

    if (mediaSources.length > 1) {
        page.querySelector('.selectSourceContainer').classList.remove('hide');
    } else {
        page.querySelector('.selectSourceContainer').classList.add('hide');
    }

    if (select.value !== currentValue || forceReload) {
        renderVideoSelections(page, mediaSources);
        renderAudioSelections(page, mediaSources);
        renderSubtitleSelections(page, mediaSources);
    }
}

function renderVideoSelections(page, mediaSources) {
    const mediaSourceId = page.querySelector('.selectSource').value;
    const mediaSource = mediaSources.filter(function (m) {
        return m.Id === mediaSourceId;
    })[0];

    const tracks = mediaSource.MediaStreams.filter(function (m) {
        return m.Type === 'Video';
    });

    const select = page.querySelector('.selectVideo');
    select.setLabel(globalize.translate('Video'));
    const selectedId = tracks.length ? tracks[0].Index : -1;
    select.innerHTML = tracks.map(function (v) {
        const selected = v.Index === selectedId ? ' selected' : '';
        const titleParts = [];
        const resolutionText = mediaInfo.getResolutionText(v);

        if (resolutionText) {
            titleParts.push(resolutionText);
        }

        if (v.Codec) {
            titleParts.push(v.Codec.toUpperCase());
        }

        return '<option value="' + v.Index + '" ' + selected + '>' + (v.DisplayTitle || titleParts.join(' ')) + '</option>';
    }).join('');
    select.setAttribute('disabled', 'disabled');

    if (tracks.length) {
        page.querySelector('.selectVideoContainer').classList.remove('hide');
    } else {
        page.querySelector('.selectVideoContainer').classList.add('hide');
    }
}

function renderAudioSelections(page, mediaSources) {
    const mediaSourceId = page.querySelector('.selectSource').value;
    const mediaSource = mediaSources.filter(function (m) {
        return m.Id === mediaSourceId;
    })[0];
    const tracks = mediaSource.MediaStreams.filter(function (m) {
        return m.Type === 'Audio';
    });
    const select = page.querySelector('.selectAudio');
    select.setLabel(globalize.translate('Audio'));
    const selectedId = mediaSource.DefaultAudioStreamIndex;
    select.innerHTML = tracks.map(function (v) {
        const selected = v.Index === selectedId ? ' selected' : '';
        return '<option value="' + v.Index + '" ' + selected + '>' + v.DisplayTitle + '</option>';
    }).join('');

    if (tracks.length > 1) {
        select.removeAttribute('disabled');
    } else {
        select.setAttribute('disabled', 'disabled');
    }

    if (tracks.length) {
        page.querySelector('.selectAudioContainer').classList.remove('hide');
    } else {
        page.querySelector('.selectAudioContainer').classList.add('hide');
    }
}

function renderSubtitleSelections(page, mediaSources) {
    const mediaSourceId = page.querySelector('.selectSource').value;
    const mediaSource = mediaSources.filter(function (m) {
        return m.Id === mediaSourceId;
    })[0];
    const tracks = mediaSource.MediaStreams.filter(function (m) {
        return m.Type === 'Subtitle';
    });
    const select = page.querySelector('.selectSubtitles');
    select.setLabel(globalize.translate('Subtitles'));
    const selectedId = mediaSource.DefaultSubtitleStreamIndex == null ? -1 : mediaSource.DefaultSubtitleStreamIndex;

    const videoTracks = mediaSource.MediaStreams.filter(function (m) {
        return m.Type === 'Video';
    });

    // This only makes sense on Video items
    if (videoTracks.length) {
        let selected = selectedId === -1 ? ' selected' : '';
        select.innerHTML = '<option value="-1">' + globalize.translate('Off') + '</option>' + tracks.map(function (v) {
            selected = v.Index === selectedId ? ' selected' : '';
            return '<option value="' + v.Index + '" ' + selected + '>' + v.DisplayTitle + '</option>';
        }).join('');

        if (tracks.length > 0) {
            select.removeAttribute('disabled');
        } else {
            select.setAttribute('disabled', 'disabled');
        }

        page.querySelector('.selectSubtitlesContainer').classList.remove('hide');
    } else {
        select.innerHTML = '';
        page.querySelector('.selectSubtitlesContainer').classList.add('hide');
    }
}

function reloadPlayButtons(page, item) {
    let canPlay = false;

    if (item.Type == 'Program') {
        const now = new Date();

        if (now >= datetime.parseISO8601Date(item.StartDate, true) && now < datetime.parseISO8601Date(item.EndDate, true)) {
            hideAll(page, 'btnPlay', true);
            canPlay = true;
        } else {
            hideAll(page, 'btnPlay');
        }

        hideAll(page, 'btnResume');
        hideAll(page, 'btnInstantMix');
        hideAll(page, 'btnShuffle');
    } else if (playbackManager.canPlay(item)) {
        hideAll(page, 'btnPlay', true);
        const enableInstantMix = ['Audio', 'MusicAlbum', 'MusicGenre', 'MusicArtist'].indexOf(item.Type) !== -1;
        hideAll(page, 'btnInstantMix', enableInstantMix);
        const enableShuffle = item.IsFolder || ['MusicAlbum', 'MusicGenre', 'MusicArtist'].indexOf(item.Type) !== -1;
        hideAll(page, 'btnShuffle', enableShuffle);
        canPlay = true;

        const isResumable = item.UserData && item.UserData.PlaybackPositionTicks > 0;
        hideAll(page, 'btnResume', isResumable);

        for (const elem of page.querySelectorAll('.btnPlay')) {
            const btnPlay = elem.querySelector('.detailButton-icon');

            if (isResumable) {
                btnPlay.classList.replace('play_arrow', 'replay');
            } else {
                btnPlay.classList.replace('replay', 'play_arrow');
            }
        }
    } else {
        hideAll(page, 'btnPlay');
        hideAll(page, 'btnResume');
        hideAll(page, 'btnInstantMix');
        hideAll(page, 'btnShuffle');
    }

    if (layoutManager.tv) {
        const btnResume = page.querySelector('.mainDetailButtons .btnResume');
        const btnPlay = page.querySelector('.mainDetailButtons .btnPlay');
        const resumeHidden = btnResume.classList.contains('hide');
        btnResume.classList.toggle('raised', !resumeHidden);
        btnPlay.classList.toggle('raised', resumeHidden);
    }

    return canPlay;
}

function reloadUserDataButtons(page, item) {
    let i;
    let length;
    const btnPlaystates = page.querySelectorAll('.btnPlaystate');

    for (i = 0, length = btnPlaystates.length; i < length; i++) {
        const btnPlaystate = btnPlaystates[i];

        if (itemHelper.canMarkPlayed(item)) {
            btnPlaystate.classList.remove('hide');
            btnPlaystate.setItem(item);
        } else {
            btnPlaystate.classList.add('hide');
            btnPlaystate.setItem(null);
        }
    }

    const btnUserRatings = page.querySelectorAll('.btnUserRating');

    for (i = 0, length = btnUserRatings.length; i < length; i++) {
        const btnUserRating = btnUserRatings[i];

        if (itemHelper.canRate(item)) {
            btnUserRating.classList.remove('hide');
            btnUserRating.setItem(item);
        } else {
            btnUserRating.classList.add('hide');
            btnUserRating.setItem(null);
        }
    }
}

function getArtistLinksHtml(artists, serverId, context) {
    const html = [];

    for (const artist of artists) {
        const href = appRouter.getRouteUrl(artist, {
            context: context,
            itemType: 'MusicArtist',
            serverId: serverId
        });
        html.push('<a style="color:inherit;" class="button-link" is="emby-linkbutton" href="' + href + '">' + artist.Name + '</a>');
    }

    return html.join(' / ');
}

/**
 * Renders the item's name block
 * @param {Object} item - Item used to render the name.
 * @param {HTMLDivElement} container - Container to render the information into.
 * @param {Object} context - Application context.
 */
function renderName(item, container, context) {
    let parentRoute;
    const parentNameHtml = [];
    let parentNameLast = false;

    if (item.AlbumArtists) {
        parentNameHtml.push(getArtistLinksHtml(item.AlbumArtists, item.ServerId, context));
        parentNameLast = true;
    } else if (item.ArtistItems && item.ArtistItems.length && item.Type === 'MusicVideo') {
        parentNameHtml.push(getArtistLinksHtml(item.ArtistItems, item.ServerId, context));
        parentNameLast = true;
    } else if (item.SeriesName && item.Type === 'Episode') {
        parentRoute = appRouter.getRouteUrl({
            Id: item.SeriesId,
            Name: item.SeriesName,
            Type: 'Series',
            IsFolder: true,
            ServerId: item.ServerId
        }, {
            context: context
        });
        parentNameHtml.push('<a style="color:inherit;" class="button-link" tabindex="-1" is="emby-linkbutton" href="' + parentRoute + '">' + item.SeriesName + '</a>');
    } else if (item.IsSeries || item.EpisodeTitle) {
        parentNameHtml.push(item.Name);
    }

    if (item.SeriesName && item.Type === 'Season') {
        parentRoute = appRouter.getRouteUrl({
            Id: item.SeriesId,
            Name: item.SeriesName,
            Type: 'Series',
            IsFolder: true,
            ServerId: item.ServerId
        }, {
            context: context
        });
        parentNameHtml.push('<a style="color:inherit;" class="button-link" tabindex="-1" is="emby-linkbutton" href="' + parentRoute + '">' + item.SeriesName + '</a>');
    } else if (item.ParentIndexNumber != null && item.Type === 'Episode') {
        parentRoute = appRouter.getRouteUrl({
            Id: item.SeasonId,
            Name: item.SeasonName,
            Type: 'Season',
            IsFolder: true,
            ServerId: item.ServerId
        }, {
            context: context
        });
        parentNameHtml.push('<a style="color:inherit;" class="button-link" tabindex="-1" is="emby-linkbutton" href="' + parentRoute + '">' + item.SeasonName + '</a>');
    } else if (item.ParentIndexNumber != null && item.IsSeries) {
        parentNameHtml.push(item.SeasonName || 'S' + item.ParentIndexNumber);
    } else if (item.Album && item.AlbumId && (item.Type === 'MusicVideo' || item.Type === 'Audio')) {
        parentRoute = appRouter.getRouteUrl({
            Id: item.AlbumId,
            Name: item.Album,
            Type: 'MusicAlbum',
            IsFolder: true,
            ServerId: item.ServerId
        }, {
            context: context
        });
        parentNameHtml.push('<a style="color:inherit;" class="button-link" tabindex="-1" is="emby-linkbutton" href="' + parentRoute + '">' + item.Album + '</a>');
    } else if (item.Album) {
        parentNameHtml.push(item.Album);
    }

    // FIXME: This whole section needs some refactoring, so it becames easier to scale across all form factors. See GH #1022
    let html = '';
    const tvShowHtml = parentNameHtml[0];
    const tvSeasonHtml = parentNameHtml[1];

    if (parentNameHtml.length) {
        if (parentNameLast) {
            // Music
            if (layoutManager.mobile) {
                html = '<h3 class="parentName musicParentName">' + parentNameHtml.join('</br>') + '</h3>';
            } else {
                html = '<h3 class="parentName musicParentName">' + parentNameHtml.join(' - ') + '</h3>';
            }
        } else {
            html = '<h1 class="parentName">' + tvShowHtml + '</h1>';
        }
    }

    const name = itemHelper.getDisplayName(item, {
        includeParentInfo: false
    });

    if (html && !parentNameLast) {
        if (tvSeasonHtml) {
            html += '<h3 class="itemName infoText subtitle">' + tvSeasonHtml + ' - ' + name + '</h3>';
        } else {
            html += '<h3 class="itemName infoText subtitle">' + name + '</h3>';
        }
    } else if (item.OriginalTitle && item.OriginalTitle != item.Name) {
        html = '<h1 class="itemName infoText parentNameLast withOriginalTitle">' + name + '</h1>' + html;
    } else {
        html = '<h1 class="itemName infoText parentNameLast">' + name + '</h1>' + html;
    }

    if (item.OriginalTitle && item.OriginalTitle != item.Name) {
        html += '<h4 class="itemName infoText originalTitle">' + item.OriginalTitle + '</h4>';
    }

    container.innerHTML = html;

    if (html.length) {
        container.classList.remove('hide');
    } else {
        container.classList.add('hide');
    }
}

function setTrailerButtonVisibility(page, item) {
    if ((item.LocalTrailerCount || item.RemoteTrailers && item.RemoteTrailers.length) && playbackManager.getSupportedCommands().indexOf('PlayTrailers') !== -1) {
        hideAll(page, 'btnPlayTrailer', true);
    } else {
        hideAll(page, 'btnPlayTrailer');
    }
}

function renderBackdrop(item) {
    if (dom.getWindowSize().innerWidth >= 1000) {
        backdrop.setBackdrops([item]);
    } else {
        backdrop.clearBackdrop();
    }
}

function renderDetailPageBackdrop(page, item, apiClient) {
    // Details banner is disabled in user settings
    if (!userSettings.detailsBanner()) {
        return false;
    }

    // Disable item backdrop for books and people because they only have primary images
    if (item.Type === 'Person' || item.Type === 'Book') {
        return false;
    }

    let imgUrl;
    let hasbackdrop = false;
    const itemBackdropElement = page.querySelector('#itemBackdrop');

    if (item.BackdropImageTags && item.BackdropImageTags.length) {
        imgUrl = apiClient.getScaledImageUrl(item.Id, {
            type: 'Backdrop',
            maxWidth: dom.getScreenWidth(),
            index: 0,
            tag: item.BackdropImageTags[0]
        });
        imageLoader.lazyImage(itemBackdropElement, imgUrl);
        hasbackdrop = true;
    } else if (item.ParentBackdropItemId && item.ParentBackdropImageTags && item.ParentBackdropImageTags.length) {
        imgUrl = apiClient.getScaledImageUrl(item.ParentBackdropItemId, {
            type: 'Backdrop',
            maxWidth: dom.getScreenWidth(),
            index: 0,
            tag: item.ParentBackdropImageTags[0]
        });
        imageLoader.lazyImage(itemBackdropElement, imgUrl);
        hasbackdrop = true;
    } else if (item.ImageTags && item.ImageTags.Primary) {
        imgUrl = apiClient.getScaledImageUrl(item.Id, {
            type: 'Primary',
            maxWidth: dom.getScreenWidth(),
            tag: item.ImageTags.Primary
        });
        imageLoader.lazyImage(itemBackdropElement, imgUrl);
        hasbackdrop = true;
    } else {
        itemBackdropElement.style.backgroundImage = '';
    }

    return hasbackdrop;
}

function reloadFromItem(instance, page, params, item, user) {
    const apiClient = ServerConnections.getApiClient(item.ServerId);

    appRouter.setTitle('');

    // Start rendering the artwork first
    renderImage(page, item);
    // Save some screen real estate in TV mode
    if (!layoutManager.tv) {
        renderLogo(page, item, apiClient);
        renderDetailPageBackdrop(page, item, apiClient);
    }

    renderBackdrop(item);

    // Render the main information for the item
    page.querySelector('.detailPagePrimaryContainer').classList.add('detailRibbon');
    renderName(item, page.querySelector('.nameContainer'), params.context);
    renderDetails(page, item, apiClient, params.context);
    renderTrackSelections(page, instance, item);

    renderSeriesTimerEditor(page, item, apiClient, user);
    renderTimerEditor(page, item, apiClient, user);
    setInitialCollapsibleState(page, item, apiClient, params.context, user);
    const canPlay = reloadPlayButtons(page, item);

    if ((item.LocalTrailerCount || item.RemoteTrailers && item.RemoteTrailers.length) && playbackManager.getSupportedCommands().indexOf('PlayTrailers') !== -1) {
        hideAll(page, 'btnPlayTrailer', true);
    } else {
        hideAll(page, 'btnPlayTrailer');
    }

    setTrailerButtonVisibility(page, item);

    if (item.Type !== 'Program' || canPlay) {
        hideAll(page, 'mainDetailButtons', true);
    } else {
        hideAll(page, 'mainDetailButtons');
    }

    showRecordingFields(instance, page, item, user);
    const groupedVersions = (item.MediaSources || []).filter(function (g) {
        return g.Type == 'Grouping';
    });

    if (user.Policy.IsAdministrator && groupedVersions.length) {
        page.querySelector('.btnSplitVersions').classList.remove('hide');
    } else {
        page.querySelector('.btnSplitVersions').classList.add('hide');
    }

    if (itemContextMenu.getCommands(getContextMenuOptions(item, user)).length) {
        hideAll(page, 'btnMoreCommands', true);
    } else {
        hideAll(page, 'btnMoreCommands');
    }

    const itemBirthday = page.querySelector('#itemBirthday');

    if (item.Type == 'Person' && item.PremiereDate) {
        try {
            const birthday = datetime.parseISO8601Date(item.PremiereDate, true);
            const durationSinceBorn = intervalToDuration({ start: birthday, end: Date.now() });
            itemBirthday.classList.remove('hide');
            if (item.EndDate) {
                itemBirthday.innerHTML = globalize.translate('BirthDateValue', birthday.toLocaleDateString());
            } else {
                itemBirthday.innerHTML = `${globalize.translate('BirthDateValue', birthday.toLocaleDateString())} ${globalize.translate('AgeValue', durationSinceBorn.years)}`;
            }
        } catch (err) {
            console.error(err);
            itemBirthday.classList.add('hide');
        }
    } else {
        itemBirthday.classList.add('hide');
    }

    const itemDeathDate = page.querySelector('#itemDeathDate');

    if (item.Type == 'Person' && item.EndDate) {
        try {
            const deathday = datetime.parseISO8601Date(item.EndDate, true);
            itemDeathDate.classList.remove('hide');
            if (item.PremiereDate) {
                const birthday = datetime.parseISO8601Date(item.PremiereDate, true);
                const durationSinceBorn = intervalToDuration({ start: birthday, end: deathday });

                itemDeathDate.innerHTML = `${globalize.translate('DeathDateValue', deathday.toLocaleDateString())} ${globalize.translate('AgeValue', durationSinceBorn.years)}`;
            } else {
                itemDeathDate.innerHTML = globalize.translate('DeathDateValue', deathday.toLocaleDateString());
            }
        } catch (err) {
            console.error(err);
            itemDeathDate.classList.add('hide');
        }
    } else {
        itemDeathDate.classList.add('hide');
    }

    const itemBirthLocation = page.querySelector('#itemBirthLocation');

    if (item.Type == 'Person' && item.ProductionLocations && item.ProductionLocations.length) {
        let location = item.ProductionLocations[0];
        if (!layoutManager.tv && appHost.supports('externallinks')) {
            location = `<a is="emby-linkbutton" class="button-link textlink" target="_blank" href="https://www.openstreetmap.org/search?query=${encodeURIComponent(location)}">${location}</a>`;
        }
        itemBirthLocation.classList.remove('hide');
        itemBirthLocation.innerHTML = globalize.translate('BirthPlaceValue', location);
    } else {
        itemBirthLocation.classList.add('hide');
    }

    setPeopleHeader(page, item);
    loading.hide();

    if (item.Type === 'Book' && item.CanDownload && appHost.supports('filedownload')) {
        hideAll(page, 'btnDownload', true);
    }

    autoFocus(page);
}

function logoImageUrl(item, apiClient, options) {
    options = options || {};
    options.type = 'Logo';

    if (item.ImageTags && item.ImageTags.Logo) {
        options.tag = item.ImageTags.Logo;
        return apiClient.getScaledImageUrl(item.Id, options);
    }

    if (item.ParentLogoImageTag) {
        options.tag = item.ParentLogoImageTag;
        return apiClient.getScaledImageUrl(item.ParentLogoItemId, options);
    }

    return null;
}

function renderLogo(page, item, apiClient) {
    const detailLogo = page.querySelector('.detailLogo');

    const url = logoImageUrl(item, apiClient, {});

    if (url) {
        detailLogo.classList.remove('hide');
        imageLoader.setLazyImage(detailLogo, url);
    } else {
        detailLogo.classList.add('hide');
    }
}

function showRecordingFields(instance, page, item, user) {
    if (!instance.currentRecordingFields) {
        const recordingFieldsElement = page.querySelector('.recordingFields');

        if (item.Type == 'Program' && user.Policy.EnableLiveTvManagement) {
            import('../../components/recordingcreator/recordingfields').then(({ default: recordingFields }) => {
                instance.currentRecordingFields = new recordingFields({
                    parent: recordingFieldsElement,
                    programId: item.Id,
                    serverId: item.ServerId
                });
                recordingFieldsElement.classList.remove('hide');
            });
        } else {
            recordingFieldsElement.classList.add('hide');
            recordingFieldsElement.innerHTML = '';
        }
    }
}

function renderLinks(page, item) {
    const externalLinksElem = page.querySelector('.itemExternalLinks');

    const links = [];

    if (!layoutManager.tv && item.HomePageUrl) {
        links.push(`<a is="emby-linkbutton" class="button-link" href="${item.HomePageUrl}" target="_blank">${globalize.translate('ButtonWebsite')}</a>`);
    }

    if (item.ExternalUrls) {
        for (const url of item.ExternalUrls) {
            links.push(`<a is="emby-linkbutton" class="button-link" href="${url.Url}" target="_blank">${url.Name}</a>`);
        }
    }

    const html = [];
    if (links.length) {
        html.push(links.join(', '));
    }

    externalLinksElem.innerHTML = html.join(', ');

    if (html.length) {
        externalLinksElem.classList.remove('hide');
    } else {
        externalLinksElem.classList.add('hide');
    }
}

function renderDetailImage(elem, item, imageLoader) {
    const itemArray = [];
    itemArray.push(item);
    const cardHtml = cardBuilder.getCardsHtml(itemArray, {
        shape: 'auto',
        showTitle: false,
        centerText: true,
        overlayText: false,
        transition: false,
        disableIndicators: true,
        overlayPlayButton: layoutManager.mobile ? false : true,
        action: layoutManager.mobile ? 'none' : 'play',
        width: dom.getWindowSize().innerWidth * 0.25
    });

    elem.innerHTML = cardHtml;
    imageLoader.lazyChildren(elem);

    // Avoid breaking the design by preventing focus of the poster using the keyboard.
    elem.querySelector('button').tabIndex = -1;
}

function renderImage(page, item) {
    renderDetailImage(
        page.querySelector('.detailImageContainer'),
        item,
        imageLoader
    );
}

function refreshDetailImageUserData(elem, item) {
    const container = elem.querySelector('.detailImageProgressContainer');

    if (container) {
        container.innerHTML = indicators.getProgressBarHtml(item);
    }
}

function refreshImage(page, item) {
    refreshDetailImageUserData(page.querySelector('.detailImageContainer'), item);
}

function setPeopleHeader(page, item) {
    if (item.MediaType == 'Audio' || item.Type == 'MusicAlbum' || item.MediaType == 'Book' || item.MediaType == 'Photo') {
        page.querySelector('#peopleHeader').innerHTML = globalize.translate('People');
    } else {
        page.querySelector('#peopleHeader').innerHTML = globalize.translate('HeaderCastAndCrew');
    }
}

function renderNextUp(page, item, user) {
    const section = page.querySelector('.nextUpSection');

    if (item.Type != 'Series') {
        return void section.classList.add('hide');
    }

    ServerConnections.getApiClient(item.ServerId).getNextUpEpisodes({
        SeriesId: item.Id,
        UserId: user.Id
    }).then(function (result) {
        if (result.Items.length) {
            section.classList.remove('hide');
        } else {
            section.classList.add('hide');
        }

        const html = cardBuilder.getCardsHtml({
            items: result.Items,
            shape: 'overflowBackdrop',
            showTitle: true,
            displayAsSpecial: item.Type == 'Season' && item.IndexNumber,
            overlayText: false,
            centerText: true,
            overlayPlayButton: true
        });
        const itemsContainer = section.querySelector('.nextUpItems');
        itemsContainer.innerHTML = html;
        imageLoader.lazyChildren(itemsContainer);
    });
}

function setInitialCollapsibleState(page, item, apiClient, context, user) {
    page.querySelector('.collectionItems').innerHTML = '';

    if (item.Type == 'Playlist') {
        page.querySelector('#childrenCollapsible').classList.remove('hide');
        renderPlaylistItems(page, item);
    } else if (item.Type == 'Studio' || item.Type == 'Person' || item.Type == 'Genre' || item.Type == 'MusicGenre' || item.Type == 'MusicArtist') {
        page.querySelector('#childrenCollapsible').classList.remove('hide');
        renderItemsByName(page, item);
    } else if (item.IsFolder) {
        if (item.Type == 'BoxSet') {
            page.querySelector('#childrenCollapsible').classList.add('hide');
        }

        renderChildren(page, item);
    } else {
        page.querySelector('#childrenCollapsible').classList.add('hide');
    }

    if (item.Type == 'Series') {
        renderSeriesSchedule(page, item);
        renderNextUp(page, item, user);
    } else {
        page.querySelector('.nextUpSection').classList.add('hide');
    }

    renderScenes(page, item);

    if (item.SpecialFeatureCount && item.SpecialFeatureCount != 0 && item.Type != 'Series') {
        page.querySelector('#specialsCollapsible').classList.remove('hide');
        renderSpecials(page, item, user);
    } else {
        page.querySelector('#specialsCollapsible').classList.add('hide');
    }

    renderCast(page, item);

    if (item.PartCount && item.PartCount > 1) {
        page.querySelector('#additionalPartsCollapsible').classList.remove('hide');
        renderAdditionalParts(page, item, user);
    } else {
        page.querySelector('#additionalPartsCollapsible').classList.add('hide');
    }

    if (item.Type == 'MusicAlbum') {
        renderMusicVideos(page, item, user);
    } else {
        page.querySelector('#musicVideosCollapsible').classList.add('hide');
    }
}

function toggleLineClamp(clampTarget, e) {
    const expandButton = e.target;
    const clampClassName = 'detail-clamp-text';

    if (clampTarget.classList.contains(clampClassName)) {
        clampTarget.classList.remove(clampClassName);
        expandButton.innerHTML = globalize.translate('ShowLess');
    } else {
        clampTarget.classList.add(clampClassName);
        expandButton.innerHTML = globalize.translate('ShowMore');
    }
}

function renderOverview(page, item) {
    for (const overviewElemnt of page.querySelectorAll('.overview')) {
        const overview = item.Overview || '';

        if (overview) {
            overviewElemnt.innerHTML = overview;
            overviewElemnt.classList.remove('hide');
            overviewElemnt.classList.add('detail-clamp-text');

            // Grab the sibling element to control the expand state
            const expandButton = overviewElemnt.parentElement.querySelector('.overview-expand');

            // Detect if we have overflow of text. Based on this StackOverflow answer
            // https://stackoverflow.com/a/35157976
            if (Math.abs(overviewElemnt.scrollHeight - overviewElemnt.offsetHeight) > 2) {
                expandButton.classList.remove('hide');
            } else {
                expandButton.classList.add('hide');
            }

            expandButton.addEventListener('click', toggleLineClamp.bind(null, overviewElemnt));

            for (const anchor of overviewElemnt.querySelectorAll('a')) {
                anchor.setAttribute('target', '_blank');
            }
        } else {
            overviewElemnt.innerHTML = '';
            overviewElemnt.classList.add('hide');
        }
    }
}

function renderGenres(page, item, context = inferContext(item)) {
    const genres = item.GenreItems || [];
    const type = context === 'music' ? 'MusicGenre' : 'Genre';

    const html = genres.map(function (p) {
        return '<a style="color:inherit;" class="button-link" is="emby-linkbutton" href="' + appRouter.getRouteUrl({
            Name: p.Name,
            Type: type,
            ServerId: item.ServerId,
            Id: p.Id
        }, {
            context: context
        }) + '">' + p.Name + '</a>';
    }).join(', ');

    const genresLabel = page.querySelector('.genresLabel');
    genresLabel.innerHTML = globalize.translate(genres.length > 1 ? 'Genres' : 'Genre');
    const genresValue = page.querySelector('.genres');
    genresValue.innerHTML = html;

    const genresGroup = page.querySelector('.genresGroup');
    if (genres.length) {
        genresGroup.classList.remove('hide');
    } else {
        genresGroup.classList.add('hide');
    }
}

function renderWriter(page, item, context) {
    const writers = (item.People || []).filter(function (person) {
        return person.Type === 'Writer';
    });

    const html = writers.map(function (person) {
        return '<a style="color:inherit;" class="button-link" is="emby-linkbutton" href="' + appRouter.getRouteUrl({
            Name: person.Name,
            Type: 'Person',
            ServerId: item.ServerId,
            Id: person.Id
        }, {
            context: context
        }) + '">' + person.Name + '</a>';
    }).join(', ');

    const writersLabel = page.querySelector('.writersLabel');
    writersLabel.innerHTML = globalize.translate(writers.length > 1 ? 'Writers' : 'Writer');
    const writersValue = page.querySelector('.writers');
    writersValue.innerHTML = html;

    const writersGroup = page.querySelector('.writersGroup');
    if (writers.length) {
        writersGroup.classList.remove('hide');
    } else {
        writersGroup.classList.add('hide');
    }
}

function renderDirector(page, item, context) {
    const directors = (item.People || []).filter(function (person) {
        return person.Type === 'Director';
    });

    const html = directors.map(function (person) {
        return '<a style="color:inherit;" class="button-link" is="emby-linkbutton" href="' + appRouter.getRouteUrl({
            Name: person.Name,
            Type: 'Person',
            ServerId: item.ServerId,
            Id: person.Id
        }, {
            context: context
        }) + '">' + person.Name + '</a>';
    }).join(', ');

    const directorsLabel = page.querySelector('.directorsLabel');
    directorsLabel.innerHTML = globalize.translate(directors.length > 1 ? 'Directors' : 'Director');
    const directorsValue = page.querySelector('.directors');
    directorsValue.innerHTML = html;

    const directorsGroup = page.querySelector('.directorsGroup');
    if (directors.length) {
        directorsGroup.classList.remove('hide');
    } else {
        directorsGroup.classList.add('hide');
    }
}

function renderMiscInfo(page, item) {
    const primaryItemMiscInfo = page.querySelectorAll('.itemMiscInfo-primary');

    for (const miscInfo of primaryItemMiscInfo) {
        mediaInfo.fillPrimaryMediaInfo(miscInfo, item, {
            interactive: true,
            episodeTitle: false,
            subtitles: false
        });

        if (miscInfo.innerHTML && item.Type !== 'SeriesTimer') {
            miscInfo.classList.remove('hide');
        } else {
            miscInfo.classList.add('hide');
        }
    }

    const secondaryItemMiscInfo = page.querySelectorAll('.itemMiscInfo-secondary');

    for (const miscInfo of secondaryItemMiscInfo) {
        mediaInfo.fillSecondaryMediaInfo(miscInfo, item, {
            interactive: true
        });

        if (miscInfo.innerHTML && item.Type !== 'SeriesTimer') {
            miscInfo.classList.remove('hide');
        } else {
            miscInfo.classList.add('hide');
        }
    }
}

function renderTagline(page, item) {
    const taglineElement = page.querySelector('.tagline');

    if (item.Taglines && item.Taglines.length) {
        taglineElement.classList.remove('hide');
        taglineElement.innerHTML = item.Taglines[0];
    } else {
        taglineElement.classList.add('hide');
    }
}

function renderDetails(page, item, apiClient, context, isStatic) {
    renderSimilarItems(page, item, context);
    renderMoreFromSeason(page, item, apiClient);
    renderMoreFromArtist(page, item, apiClient);
    renderDirector(page, item, context);
    renderWriter(page, item, context);
    renderGenres(page, item, context);
    renderChannelGuide(page, apiClient, item);
    renderTagline(page, item);
    renderOverview(page, item);
    renderMiscInfo(page, item);
    reloadUserDataButtons(page, item);

    // Don't allow redirection to other websites from the TV layout
    if (!layoutManager.tv && appHost.supports('externallinks')) {
        renderLinks(page, item);
    }

    renderTags(page, item);
    renderSeriesAirTime(page, item, isStatic);
}

function enableScrollX() {
    return browser.mobile && window.screen.availWidth <= 1000;
}

function getPortraitShape(scrollX) {
    if (scrollX == null) {
        scrollX = enableScrollX();
    }

    return scrollX ? 'overflowPortrait' : 'portrait';
}

function getSquareShape(scrollX) {
    if (scrollX == null) {
        scrollX = enableScrollX();
    }

    return scrollX ? 'overflowSquare' : 'square';
}

function renderMoreFromSeason(view, item, apiClient) {
    const section = view.querySelector('.moreFromSeasonSection');

    if (section) {
        if (item.Type !== 'Episode' || !item.SeasonId || !item.SeriesId) {
            return void section.classList.add('hide');
        }

        const userId = apiClient.getCurrentUserId();
        apiClient.getEpisodes(item.SeriesId, {
            SeasonId: item.SeasonId,
            UserId: userId,
            Fields: 'ItemCounts,PrimaryImageAspectRatio,BasicSyncInfo,CanDelete,MediaSourceCount'
        }).then(function (result) {
            if (result.Items.length < 2) {
                return void section.classList.add('hide');
            }

            section.classList.remove('hide');
            section.querySelector('h2').innerHTML = globalize.translate('MoreFromValue', item.SeasonName);
            const itemsContainer = section.querySelector('.itemsContainer');
            cardBuilder.buildCards(result.Items, {
                parentContainer: section,
                itemsContainer: itemsContainer,
                shape: 'autooverflow',
                sectionTitleTagName: 'h2',
                scalable: true,
                showTitle: true,
                overlayText: false,
                centerText: true,
                includeParentInfoInTitle: false,
                allowBottomPadding: false
            });
            const card = itemsContainer.querySelector('.card[data-id="' + item.Id + '"]');

            if (card) {
                setTimeout(function () {
                    section.querySelector('.emby-scroller').toStart(card.previousSibling || card, true);
                }, 100);
            }
        });
    }
}

function renderMoreFromArtist(view, item, apiClient) {
    const section = view.querySelector('.moreFromArtistSection');

    if (section) {
        if (item.Type === 'MusicArtist') {
            if (!apiClient.isMinServerVersion('3.4.1.19')) {
                return void section.classList.add('hide');
            }
        } else if (item.Type !== 'MusicAlbum' || !item.AlbumArtists || !item.AlbumArtists.length) {
            return void section.classList.add('hide');
        }

        const query = {
            IncludeItemTypes: 'MusicAlbum',
            Recursive: true,
            ExcludeItemIds: item.Id,
            SortBy: 'PremiereDate,ProductionYear,SortName',
            SortOrder: 'Descending'
        };

        if (item.Type === 'MusicArtist') {
            query.AlbumArtistIds = item.Id;
        } else {
            query.AlbumArtistIds = item.AlbumArtists[0].Id;
        }

        apiClient.getItems(apiClient.getCurrentUserId(), query).then(function (result) {
            if (!result.Items.length) {
                return void section.classList.add('hide');
            }

            section.classList.remove('hide');

            if (item.Type === 'MusicArtist') {
                section.querySelector('h2').innerHTML = globalize.translate('HeaderAppearsOn');
            } else {
                section.querySelector('h2').innerHTML = globalize.translate('MoreFromValue', item.AlbumArtists[0].Name);
            }

            cardBuilder.buildCards(result.Items, {
                parentContainer: section,
                itemsContainer: section.querySelector('.itemsContainer'),
                shape: 'autooverflow',
                sectionTitleTagName: 'h2',
                scalable: true,
                coverImage: item.Type === 'MusicArtist' || item.Type === 'MusicAlbum',
                showTitle: true,
                showParentTitle: false,
                centerText: true,
                overlayText: false,
                overlayPlayButton: true,
                showYear: true
            });
        });
    }
}

function renderSimilarItems(page, item, context) {
    const similarCollapsible = page.querySelector('#similarCollapsible');

    if (similarCollapsible) {
        if (item.Type != 'Movie' && item.Type != 'Trailer' && item.Type != 'Series' && item.Type != 'Program' && item.Type != 'Recording' && item.Type != 'MusicAlbum' && item.Type != 'MusicArtist' && item.Type != 'Playlist') {
            return void similarCollapsible.classList.add('hide');
        }

        similarCollapsible.classList.remove('hide');
        const apiClient = ServerConnections.getApiClient(item.ServerId);
        const options = {
            userId: apiClient.getCurrentUserId(),
            limit: 12,
            fields: 'PrimaryImageAspectRatio,CanDelete'
        };

        if (item.Type == 'MusicAlbum' && item.AlbumArtists && item.AlbumArtists.length) {
            options.ExcludeArtistIds = item.AlbumArtists[0].Id;
        }

        apiClient.getSimilarItems(item.Id, options).then(function (result) {
            if (!result.Items.length) {
                return void similarCollapsible.classList.add('hide');
            }

            similarCollapsible.classList.remove('hide');
            let html = '';
            html += cardBuilder.getCardsHtml({
                items: result.Items,
                shape: 'autooverflow',
                showParentTitle: item.Type == 'MusicAlbum',
                centerText: true,
                showTitle: true,
                context: context,
                lazy: true,
                showDetailsMenu: true,
                coverImage: item.Type == 'MusicAlbum' || item.Type == 'MusicArtist',
                overlayPlayButton: true,
                overlayText: false,
                showYear: item.Type === 'Movie' || item.Type === 'Trailer' || item.Type === 'Series'
            });
            const similarContent = similarCollapsible.querySelector('.similarContent');
            similarContent.innerHTML = html;
            imageLoader.lazyChildren(similarContent);
        });
    }
}

function renderSeriesAirTime(page, item, isStatic) {
    const seriesAirTime = page.querySelector('#seriesAirTime');
    if (item.Type != 'Series') {
        seriesAirTime.classList.add('hide');
        return;
    }
    let html = '';
    if (item.AirDays && item.AirDays.length) {
        if (item.AirDays.length == 7) {
            html += 'daily';
        } else {
            html += item.AirDays.map(function (a) {
                return a + 's';
            }).join(',');
        }
    }
    if (item.AirTime) {
        html += ' at ' + item.AirTime;
    }
    if (item.Studios.length) {
        if (isStatic) {
            html += ' on ' + item.Studios[0].Name;
        } else {
            const context = inferContext(item);
            const href = appRouter.getRouteUrl(item.Studios[0], {
                context: context,
                itemType: 'Studio',
                serverId: item.ServerId
            });
            html += ' on <a class="textlink button-link" is="emby-linkbutton" href="' + href + '">' + item.Studios[0].Name + '</a>';
        }
    }
    if (html) {
        html = (item.Status == 'Ended' ? 'Aired ' : 'Airs ') + html;
        seriesAirTime.innerHTML = html;
        seriesAirTime.classList.remove('hide');
    } else {
        seriesAirTime.classList.add('hide');
    }
}

function renderTags(page, item) {
    const itemTags = page.querySelector('.itemTags');
    const tagElements = [];
    let tags = item.Tags || [];

    if (item.Type === 'Program') {
        tags = [];
    }

    for (let i = 0, length = tags.length; i < length; i++) {
        tagElements.push(tags[i]);
    }

    if (tagElements.length) {
        itemTags.innerHTML = globalize.translate('TagsValue', tagElements.join(', '));
        itemTags.classList.remove('hide');
    } else {
        itemTags.innerHTML = '';
        itemTags.classList.add('hide');
    }
}

function renderChildren(page, item) {
    let fields = 'ItemCounts,PrimaryImageAspectRatio,BasicSyncInfo,CanDelete,MediaSourceCount';
    const query = {
        ParentId: item.Id,
        Fields: fields
    };

    if (item.Type !== 'BoxSet') {
        query.SortBy = 'SortName';
    }

    let promise;
    const apiClient = ServerConnections.getApiClient(item.ServerId);
    const userId = apiClient.getCurrentUserId();

    if (item.Type == 'Series') {
        promise = apiClient.getSeasons(item.Id, {
            userId: userId,
            Fields: fields
        });
    } else if (item.Type == 'Season') {
        fields += ',Overview';
        promise = apiClient.getEpisodes(item.SeriesId, {
            seasonId: item.Id,
            userId: userId,
            Fields: fields
        });
    } else if (item.Type == 'MusicArtist') {
        query.SortBy = 'PremiereDate,ProductionYear,SortName';
    }

    promise = promise || apiClient.getItems(apiClient.getCurrentUserId(), query);
    promise.then(function (result) {
        let html = '';
        let scrollX = false;
        let isList = false;
        const childrenItemsContainer = page.querySelector('.childrenItemsContainer');

        if (item.Type == 'MusicAlbum') {
            const equalSet = (arr1, arr2) => arr1.every(x => arr2.indexOf(x) !== -1) && arr1.length === arr2.length;
            let showArtist = false;
            for (const track of result.Items) {
                if (!equalSet(track.ArtistItems.map(x => x.Id), track.AlbumArtists.map(x => x.Id))) {
                    showArtist = true;
                    break;
                }
            }
            const discNumbers = result.Items.map(x => x.ParentIndexNumber);
            html = listView.getListViewHtml({
                items: result.Items,
                smallIcon: true,
                showIndex: new Set(discNumbers).size > 1 || (discNumbers.length >= 1 && discNumbers[0] > 1),
                index: 'disc',
                showIndexNumberLeft: true,
                playFromHere: true,
                action: 'playallfromhere',
                image: false,
                artist: showArtist,
                containerAlbumArtists: item.AlbumArtists
            });
            isList = true;
        } else if (item.Type == 'Series') {
            scrollX = enableScrollX();
            html = cardBuilder.getCardsHtml({
                items: result.Items,
                shape: 'overflowPortrait',
                showTitle: true,
                centerText: true,
                lazy: true,
                overlayPlayButton: true,
                allowBottomPadding: !scrollX
            });
        } else if (item.Type == 'Season' || item.Type == 'Episode') {
            if (item.Type !== 'Episode') {
                isList = true;
            }
            scrollX = item.Type == 'Episode';
            if (result.Items.length < 2 && item.Type === 'Episode') {
                return;
            }

            if (item.Type === 'Episode') {
                html = cardBuilder.getCardsHtml({
                    items: result.Items,
                    shape: 'overflowBackdrop',
                    showTitle: true,
                    displayAsSpecial: item.Type == 'Season' && item.IndexNumber,
                    playFromHere: true,
                    overlayText: true,
                    lazy: true,
                    showDetailsMenu: true,
                    overlayPlayButton: true,
                    allowBottomPadding: !scrollX,
                    includeParentInfoInTitle: false
                });
            } else if (item.Type === 'Season') {
                html = listView.getListViewHtml({
                    items: result.Items,
                    showIndexNumber: false,
                    enableOverview: true,
                    enablePlayedButton: layoutManager.mobile ? false : true,
                    infoButton: layoutManager.mobile ? false : true,
                    imageSize: 'large',
                    enableSideMediaInfo: false,
                    highlight: false,
                    action: !layoutManager.desktop ? 'link' : 'none',
                    imagePlayButton: true,
                    includeParentInfoInTitle: false
                });
            }
        }

        if (item.Type !== 'BoxSet') {
            page.querySelector('#childrenCollapsible').classList.remove('hide');
        }
        if (scrollX) {
            childrenItemsContainer.classList.add('scrollX');
            childrenItemsContainer.classList.add('hiddenScrollX');
            childrenItemsContainer.classList.remove('vertical-wrap');
            childrenItemsContainer.classList.remove('vertical-list');
        } else {
            childrenItemsContainer.classList.remove('scrollX');
            childrenItemsContainer.classList.remove('hiddenScrollX');
            childrenItemsContainer.classList.remove('smoothScrollX');
            if (isList) {
                childrenItemsContainer.classList.add('vertical-list');
                childrenItemsContainer.classList.remove('vertical-wrap');
            } else {
                childrenItemsContainer.classList.add('vertical-wrap');
                childrenItemsContainer.classList.remove('vertical-list');
            }
        }
        if (layoutManager.mobile) {
            childrenItemsContainer.classList.remove('padded-right');
        }
        childrenItemsContainer.innerHTML = html;
        imageLoader.lazyChildren(childrenItemsContainer);
        if (item.Type == 'BoxSet') {
            const collectionItemTypes = [{
                name: globalize.translate('HeaderVideos'),
                mediaType: 'Video'
            }, {
                name: globalize.translate('Series'),
                type: 'Series'
            }, {
                name: globalize.translate('Albums'),
                type: 'MusicAlbum'
            }, {
                name: globalize.translate('Books'),
                type: 'Book'
            }];
            renderCollectionItems(page, item, collectionItemTypes, result.Items);
        }
    });

    if (item.Type == 'Season') {
        page.querySelector('#childrenTitle').innerHTML = globalize.translate('Episodes');
    } else if (item.Type == 'Series') {
        page.querySelector('#childrenTitle').innerHTML = globalize.translate('HeaderSeasons');
    } else if (item.Type == 'MusicAlbum') {
        page.querySelector('#childrenTitle').innerHTML = globalize.translate('HeaderTracks');
    } else {
        page.querySelector('#childrenTitle').innerHTML = globalize.translate('Items');
    }

    if (item.Type == 'MusicAlbum' || item.Type == 'Season') {
        page.querySelector('.childrenSectionHeader').classList.add('hide');
        page.querySelector('#childrenCollapsible').classList.add('verticalSection-extrabottompadding');
    } else {
        page.querySelector('.childrenSectionHeader').classList.remove('hide');
    }
}

function renderItemsByName(page, item) {
    import('../../scripts/itembynamedetailpage').then(() => {
        window.ItemsByName.renderItems(page, item);
    });
}

function renderPlaylistItems(page, item) {
    import('../../scripts/playlistedit').then(() => {
        PlaylistViewer.render(page, item);
    });
}

function renderProgramsForChannel(page, result) {
    let html = '';
    let currentItems = [];
    let currentStartDate = null;

    for (let i = 0, length = result.Items.length; i < length; i++) {
        const item = result.Items[i];
        const itemStartDate = datetime.parseISO8601Date(item.StartDate);

        if (!(currentStartDate && currentStartDate.toDateString() === itemStartDate.toDateString())) {
            if (currentItems.length) {
                html += '<div class="verticalSection verticalDetailSection">';
                html += '<h2 class="sectionTitle padded-left">' + datetime.toLocaleDateString(currentStartDate, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric'
                }) + '</h2>';
                html += '<div is="emby-itemscontainer" class="vertical-list padded-left padded-right">' + listView.getListViewHtml({
                    items: currentItems,
                    enableUserDataButtons: false,
                    showParentTitle: true,
                    image: false,
                    showProgramTime: true,
                    mediaInfo: false,
                    parentTitleWithTitle: true
                }) + '</div></div>';
            }

            currentStartDate = itemStartDate;
            currentItems = [];
        }

        currentItems.push(item);
    }

    if (currentItems.length) {
        html += '<div class="verticalSection verticalDetailSection">';
        html += '<h2 class="sectionTitle padded-left">' + datetime.toLocaleDateString(currentStartDate, {
            weekday: 'long',
            month: 'long',
            day: 'numeric'
        }) + '</h2>';
        html += '<div is="emby-itemscontainer" class="vertical-list padded-left padded-right">' + listView.getListViewHtml({
            items: currentItems,
            enableUserDataButtons: false,
            showParentTitle: true,
            image: false,
            showProgramTime: true,
            mediaInfo: false,
            parentTitleWithTitle: true
        }) + '</div></div>';
    }

    page.querySelector('.programGuide').innerHTML = html;
}

function renderChannelGuide(page, apiClient, item) {
    if (item.Type === 'TvChannel') {
        page.querySelector('.programGuideSection').classList.remove('hide');
        apiClient.getLiveTvPrograms({
            ChannelIds: item.Id,
            UserId: apiClient.getCurrentUserId(),
            HasAired: false,
            SortBy: 'StartDate',
            EnableTotalRecordCount: false,
            EnableImages: false,
            ImageTypeLimit: 0,
            EnableUserData: false
        }).then(function (result) {
            renderProgramsForChannel(page, result);
        });
    }
}

function renderSeriesSchedule(page, item) {
    const apiClient = ServerConnections.getApiClient(item.ServerId);
    apiClient.getLiveTvPrograms({
        UserId: apiClient.getCurrentUserId(),
        HasAired: false,
        SortBy: 'StartDate',
        EnableTotalRecordCount: false,
        EnableImages: false,
        ImageTypeLimit: 0,
        Limit: 50,
        EnableUserData: false,
        LibrarySeriesId: item.Id
    }).then(function (result) {
        if (result.Items.length) {
            page.querySelector('#seriesScheduleSection').classList.remove('hide');
        } else {
            page.querySelector('#seriesScheduleSection').classList.add('hide');
        }

        page.querySelector('#seriesScheduleList').innerHTML = listView.getListViewHtml({
            items: result.Items,
            enableUserDataButtons: false,
            showParentTitle: false,
            image: false,
            showProgramDateTime: true,
            mediaInfo: false,
            showTitle: true,
            moreButton: false,
            action: 'programdialog'
        });
        loading.hide();
    });
}

function inferContext(item) {
    if (item.Type === 'Movie' || item.Type === 'BoxSet') {
        return 'movies';
    }

    if (item.Type === 'Series' || item.Type === 'Season' || item.Type === 'Episode') {
        return 'tvshows';
    }

    if (item.Type === 'MusicArtist' || item.Type === 'MusicAlbum' || item.Type === 'Audio' || item.Type === 'AudioBook') {
        return 'music';
    }

    if (item.Type === 'Program') {
        return 'livetv';
    }

    return null;
}

function filterItemsByCollectionItemType(items, typeInfo) {
    return items.filter(function (item) {
        if (typeInfo.mediaType) {
            return item.MediaType == typeInfo.mediaType;
        }

        return item.Type == typeInfo.type;
    });
}

function canPlaySomeItemInCollection(items) {
    let i = 0;

    for (let length = items.length; i < length; i++) {
        if (playbackManager.canPlay(items[i])) {
            return true;
        }
    }

    return false;
}

function renderCollectionItems(page, parentItem, types, items) {
    page.querySelector('.collectionItems').classList.remove('hide');
    page.querySelector('.collectionItems').innerHTML = '';

    for (const type of types) {
        const typeItems = filterItemsByCollectionItemType(items, type);

        if (typeItems.length) {
            renderCollectionItemType(page, parentItem, type, typeItems);
        }
    }

    const otherType = {
        name: globalize.translate('HeaderOtherItems')
    };
    const otherTypeItems = items.filter(function (curr) {
        return !types.filter(function (t) {
            return filterItemsByCollectionItemType([curr], t).length > 0;
        }).length;
    });

    if (otherTypeItems.length) {
        renderCollectionItemType(page, parentItem, otherType, otherTypeItems);
    }

    if (!items.length) {
        renderCollectionItemType(page, parentItem, {
            name: globalize.translate('Items')
        }, items);
    }

    const containers = page.querySelectorAll('.collectionItemsContainer');

    const notifyRefreshNeeded = function () {
        renderChildren(page, parentItem);
    };

    for (const container of containers) {
        container.notifyRefreshNeeded = notifyRefreshNeeded;
    }

    // if nothing in the collection can be played hide play and shuffle buttons
    if (!canPlaySomeItemInCollection(items)) {
        hideAll(page, 'btnPlay', false);
        hideAll(page, 'btnShuffle', false);
    }

    // HACK: Call autoFocuser again because btnPlay may be hidden, but focused by reloadFromItem
    // FIXME: Sometimes focus does not move until all (?) sections are loaded
    autoFocus(page);
}

function renderCollectionItemType(page, parentItem, type, items) {
    let html = '';
    html += '<div class="verticalSection">';
    html += '<div class="sectionTitleContainer sectionTitleContainer-cards padded-left">';
    html += '<h2 class="sectionTitle sectionTitle-cards">';
    html += '<span>' + type.name + '</span>';
    html += '</h2>';
    html += '</div>';
    html += '<div is="emby-itemscontainer" class="itemsContainer collectionItemsContainer vertical-wrap padded-left padded-right">';
    const shape = type.type == 'MusicAlbum' ? getSquareShape(false) : getPortraitShape(false);
    html += cardBuilder.getCardsHtml({
        items: items,
        shape: shape,
        showTitle: true,
        showYear: type.mediaType === 'Video' || type.type === 'Series',
        centerText: true,
        lazy: true,
        showDetailsMenu: true,
        overlayMoreButton: true,
        showAddToCollection: false,
        showRemoveFromCollection: true,
        collectionId: parentItem.Id
    });
    html += '</div>';
    html += '</div>';
    const collectionItems = page.querySelector('.collectionItems');
    collectionItems.insertAdjacentHTML('beforeend', html);
    imageLoader.lazyChildren(collectionItems.lastChild);
}

function renderMusicVideos(page, item, user) {
    ServerConnections.getApiClient(item.ServerId).getItems(user.Id, {
        SortBy: 'SortName',
        SortOrder: 'Ascending',
        IncludeItemTypes: 'MusicVideo',
        Recursive: true,
        Fields: 'PrimaryImageAspectRatio,BasicSyncInfo,CanDelete,MediaSourceCount',
        AlbumIds: item.Id
    }).then(function (result) {
        if (result.Items.length) {
            page.querySelector('#musicVideosCollapsible').classList.remove('hide');
            const musicVideosContent = page.querySelector('#musicVideosContent');
            musicVideosContent.innerHTML = getVideosHtml(result.Items);
            imageLoader.lazyChildren(musicVideosContent);
        } else {
            page.querySelector('#musicVideosCollapsible').classList.add('hide');
        }
    });
}

function renderAdditionalParts(page, item, user) {
    ServerConnections.getApiClient(item.ServerId).getAdditionalVideoParts(user.Id, item.Id).then(function (result) {
        if (result.Items.length) {
            page.querySelector('#additionalPartsCollapsible').classList.remove('hide');
            const additionalPartsContent = page.querySelector('#additionalPartsContent');
            additionalPartsContent.innerHTML = getVideosHtml(result.Items);
            imageLoader.lazyChildren(additionalPartsContent);
        } else {
            page.querySelector('#additionalPartsCollapsible').classList.add('hide');
        }
    });
}

function renderScenes(page, item) {
    let chapters = item.Chapters || [];

    if (chapters.length && !chapters[0].ImageTag && (chapters = []), chapters.length) {
        page.querySelector('#scenesCollapsible').classList.remove('hide');
        const scenesContent = page.querySelector('#scenesContent');

        import('../../components/cardbuilder/chaptercardbuilder').then(({ default: chaptercardbuilder }) => {
            chaptercardbuilder.buildChapterCards(item, chapters, {
                itemsContainer: scenesContent,
                backdropShape: 'overflowBackdrop',
                squareShape: 'overflowSquare',
                imageBlurhashes: item.ImageBlurHashes
            });
        });
    } else {
        page.querySelector('#scenesCollapsible').classList.add('hide');
    }
}

function getVideosHtml(items) {
    return cardBuilder.getCardsHtml({
        items: items,
        shape: 'autooverflow',
        showTitle: true,
        action: 'play',
        overlayText: false,
        centerText: true,
        showRuntime: true
    });
}

function renderSpecials(page, item, user) {
    ServerConnections.getApiClient(item.ServerId).getSpecialFeatures(user.Id, item.Id).then(function (specials) {
        const specialsContent = page.querySelector('#specialsContent');
        specialsContent.innerHTML = getVideosHtml(specials);
        imageLoader.lazyChildren(specialsContent);
    });
}

function renderCast(page, item) {
    const people = (item.People || []).filter(function (p) {
        return p.Type === 'Actor';
    });

    if (!people.length) {
        return void page.querySelector('#castCollapsible').classList.add('hide');
    }

    page.querySelector('#castCollapsible').classList.remove('hide');
    const castContent = page.querySelector('#castContent');

    import('../../components/cardbuilder/peoplecardbuilder').then(({ default: peoplecardbuilder }) => {
        peoplecardbuilder.buildPeopleCards(people, {
            itemsContainer: castContent,
            coverImage: true,
            serverId: item.ServerId,
            shape: 'overflowPortrait',
            imageBlurhashes: item.ImageBlurHashes
        });
    });
}

function itemDetailPage() {
    const self = this;
    self.setInitialCollapsibleState = setInitialCollapsibleState;
    self.renderDetails = renderDetails;
    self.renderCast = renderCast;
}

function bindAll(view, selector, eventName, fn) {
    const elems = view.querySelectorAll(selector);

    for (const elem of elems) {
        elem.addEventListener(eventName, fn);
    }
}

function onTrackSelectionsSubmit(e) {
    e.preventDefault();
    return false;
}

window.ItemDetailPage = new itemDetailPage();

export default function (view, params) {
    function getApiClient() {
        return params.serverId ? ServerConnections.getApiClient(params.serverId) : ApiClient;
    }

    function reload(instance, page, params) {
        loading.show();

        const apiClient = getApiClient();

        Promise.all([getPromise(apiClient, params), apiClient.getCurrentUser()]).then(([item, user]) => {
            currentItem = item;
            reloadFromItem(instance, page, params, item, user);
        }).catch((error) => {
            console.error('failed to get item or current user: ', error);
        });
    }

    function splitVersions(instance, page, apiClient, params) {
        confirm('Are you sure you wish to split the media sources into separate items?', 'Split Media Apart').then(function () {
            loading.show();
            apiClient.ajax({
                type: 'DELETE',
                url: apiClient.getUrl('Videos/' + params.id + '/AlternateSources')
            }).then(function () {
                loading.hide();
                reload(instance, page, params);
            });
        });
    }

    function getPlayOptions(startPosition) {
        const audioStreamIndex = view.querySelector('.selectAudio').value || null;
        return {
            startPositionTicks: startPosition,
            mediaSourceId: view.querySelector('.selectSource').value,
            audioStreamIndex: audioStreamIndex,
            subtitleStreamIndex: view.querySelector('.selectSubtitles').value
        };
    }

    function playItem(item, startPosition) {
        const playOptions = getPlayOptions(startPosition);
        playOptions.items = [item];
        playbackManager.play(playOptions);
    }

    function playTrailer() {
        playbackManager.playTrailers(currentItem);
    }

    function playCurrentItem(button, mode) {
        const item = currentItem;

        if (item.Type === 'Program') {
            const apiClient = ServerConnections.getApiClient(item.ServerId);
            return void apiClient.getLiveTvChannel(item.ChannelId, apiClient.getCurrentUserId()).then(function (channel) {
                playbackManager.play({
                    items: [channel]
                });
            });
        }

        playItem(item, item.UserData && mode === 'resume' ? item.UserData.PlaybackPositionTicks : 0);
    }

    function onPlayClick() {
        playCurrentItem(this, this.getAttribute('data-mode'));
    }

    function onPosterClick(e) {
        itemShortcuts.onClick.call(view.querySelector('.detailImageContainer'), e);
    }

    function onInstantMixClick() {
        playbackManager.instantMix(currentItem);
    }

    function onShuffleClick() {
        playbackManager.shuffle(currentItem);
    }

    function onCancelSeriesTimerClick() {
        import('../../components/recordingcreator/recordinghelper').then(({ default: recordingHelper }) => {
            recordingHelper.cancelSeriesTimerWithConfirmation(currentItem.Id, currentItem.ServerId).then(function () {
                Dashboard.navigate('livetv.html');
            });
        });
    }

    function onCancelTimerClick() {
        import('../../components/recordingcreator/recordinghelper').then(({ default: recordingHelper }) => {
            recordingHelper.cancelTimer(ServerConnections.getApiClient(currentItem.ServerId), currentItem.TimerId).then(function () {
                reload(self, view, params);
            });
        });
    }

    function onPlayTrailerClick() {
        playTrailer();
    }

    function onDownloadClick() {
        const downloadHref = getApiClient().getItemDownloadUrl(currentItem.Id);
        download([{
            url: downloadHref,
            itemId: currentItem.Id,
            serverId: currentItem.serverId
        }]);
    }

    function onMoreCommandsClick() {
        const button = this;
        let selectedItem = view.querySelector('.selectSource').value || currentItem.Id;

        const apiClient = getApiClient();

        apiClient.getItem(apiClient.getCurrentUserId(), selectedItem).then(function (item) {
            selectedItem = item;

            apiClient.getCurrentUser().then(function (user) {
                itemContextMenu.show(getContextMenuOptions(selectedItem, user, button)).then(function (result) {
                    if (result.deleted) {
                        appRouter.goHome();
                    } else if (result.updated) {
                        reload(self, view, params);
                    }
                });
            });
        });
    }

    function onPlayerChange() {
        renderTrackSelections(view, self, currentItem);
        setTrailerButtonVisibility(view, currentItem);
    }

    function onWebSocketMessage(e, data) {
        const msg = data;
        const apiClient = getApiClient();

        if (msg.MessageType === 'UserDataChanged' && currentItem && msg.Data.UserId == apiClient.getCurrentUserId()) {
            const key = currentItem.UserData.Key;
            const userData = msg.Data.UserDataList.filter(function (u) {
                return u.Key == key;
            })[0];

            if (userData) {
                currentItem.UserData = userData;
                reloadPlayButtons(view, currentItem);
                refreshImage(view, currentItem);
                autoFocus(view);
            }
        }
    }

    let currentItem;
    const self = this;

    function init() {
        const apiClient = getApiClient();

        view.querySelectorAll('.btnPlay');
        bindAll(view, '.btnPlay', 'click', onPlayClick);
        bindAll(view, '.btnResume', 'click', onPlayClick);
        bindAll(view, '.btnInstantMix', 'click', onInstantMixClick);
        bindAll(view, '.btnShuffle', 'click', onShuffleClick);
        bindAll(view, '.btnPlayTrailer', 'click', onPlayTrailerClick);
        bindAll(view, '.btnCancelSeriesTimer', 'click', onCancelSeriesTimerClick);
        bindAll(view, '.btnCancelTimer', 'click', onCancelTimerClick);
        bindAll(view, '.btnDownload', 'click', onDownloadClick);
        view.querySelector('.detailImageContainer').addEventListener('click', onPosterClick);
        view.querySelector('.trackSelections').addEventListener('submit', onTrackSelectionsSubmit);
        view.querySelector('.btnSplitVersions').addEventListener('click', function () {
            splitVersions(self, view, apiClient, params);
        });
        bindAll(view, '.btnMoreCommands', 'click', onMoreCommandsClick);
        view.querySelector('.selectSource').addEventListener('change', function () {
            renderVideoSelections(view, self._currentPlaybackMediaSources);
            renderAudioSelections(view, self._currentPlaybackMediaSources);
            renderSubtitleSelections(view, self._currentPlaybackMediaSources);
        });
        view.addEventListener('viewshow', function (e) {
            const page = this;

            libraryMenu.setTransparentMenu(!layoutManager.mobile);

            if (e.detail.isRestored) {
                if (currentItem) {
                    appRouter.setTitle('');
                    renderTrackSelections(page, self, currentItem, true);
                }
            } else {
                reload(self, page, params);
            }

            Events.on(apiClient, 'message', onWebSocketMessage);
            Events.on(playbackManager, 'playerchange', onPlayerChange);
        });
        view.addEventListener('viewbeforehide', function () {
            Events.off(apiClient, 'message', onWebSocketMessage);
            Events.off(playbackManager, 'playerchange', onPlayerChange);
            libraryMenu.setTransparentMenu(false);
        });
        view.addEventListener('viewdestroy', function () {
            currentItem = null;
            self._currentPlaybackMediaSources = null;
            self.currentRecordingFields = null;
        });
    }

    init();
}
