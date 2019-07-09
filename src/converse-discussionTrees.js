// Converse.js
// https://conversejs.org
//
// Copyright (c) 2013-2019, the Converse.js developers
// Licensed under the Mozilla Public License (MPLv2)

import "backbone.nativeview";
import "converse-chatboxviews";
import "converse-chatview";
import "converse-message-view";
import "converse-modal";
import * as twemoji from "twemoji";
import BrowserStorage from "backbone.browserStorage";
import { Overview } from "backbone.overview";
import bootstrap from "bootstrap.native";
import converse from "@converse/headless/converse-core";
import tpl_alert from "templates/alert.html";
import tpl_chatbox from "templates/chatbox.html";
import tpl_chatbox_head from "templates/chatbox_head.html";
import tpl_chatbox_message_form from "templates/chatbox_message_form.html";
import tpl_emojis from "templates/emojis.html";
import tpl_error_message from "templates/error_message.html";
import tpl_help_message from "templates/help_message.html";
import tpl_info from "templates/info.html";
import tpl_new_day from "templates/new_day.html";
import tpl_spinner from "templates/spinner.html";
import tpl_spoiler_button from "templates/spoiler_button.html";
import tpl_status_message from "templates/status_message.html";
import tpl_toolbar from "templates/toolbar.html";
import tpl_toolbar_fileupload from "templates/toolbar_fileupload.html";
import tpl_user_details_modal from "templates/user_details_modal.html";
import u from "@converse/headless/utils/emoji";
import xss from "xss/dist/xss";

const { $msg, Backbone, Promise, Strophe, _, sizzle, dayjs } = converse.env;


converse.plugins.add('converse-discussionTrees', {
    /* Plugin dependencies are other plugins which might be
     * overridden or relied upon, and therefore need to be loaded before
     * this plugin.
     *
     * If the setting "strict_plugin_dependencies" is set to true,
     * an error will be raised if the plugin is not found. By default it's
     * false, which means these plugins are only loaded opportunistically.
     *
     * NB: These plugins need to have already been loaded via require.js.
     */
    dependencies: ["converse-chatview", "converse-chatboxviews", "converse-disco", "converse-message-view", "converse-modal"],


    initialize () {
        /* The initialize function gets called as soon as the plugin is
         * loaded by converse.js's plugin machinery.
         */
        const { _converse } = this,
            { __ } = _converse;

        _converse.api.settings.update({
            'auto_focus': true,
            'emoji_image_path': twemoji.default.base,
            'message_limit': 0,
            'show_send_button': false,
            'show_toolbar': true,
            'time_format': 'HH:mm',
            'use_system_emojis': true,
            'visible_toolbar_buttons': {
                'call': false,
                'clear': true,
                'emoji': true,
                'spoiler': true
            },
        });
        twemoji.default.base = _converse.emoji_image_path;

        function onWindowStateChanged (data) {
            if (_converse.chatboxviews) {
                _converse.chatboxviews.forEach(view => {
                    if (view.model.get('id') !== 'controlbox') {
                        view.onWindowStateChanged(data.state);
                    }
                });
            }
        }
        _converse.api.listen.on('windowStateChanged', onWindowStateChanged);



        /**
         * The View of an open/ongoing chat conversation.
         *
         * @class
         * @namespace _converse.ChatBoxView
         * @memberOf _converse
         */
        _converse.DicussionTreeView = Overview.extend({
            length: 200,
            className: 'chatbox hidden',
            is_chatroom: false,  // Leaky abstraction from MUC

            events: {
                'click .chat-msg__action-reply': 'onMessageReplyButtonClicked'
            },

            initialize () {
                /**
                 * Triggered once the _converse.ChatBoxView has been initialized
                 * @event _converse#chatBoxInitialized
                 * @type { _converse.ChatBoxView | _converse.HeadlinesBoxView }
                 * @example _converse.api.listen.on('chatBoxInitialized', view => { ... });
                 */
                _converse.api.trigger('chatBoxInitialized', this);
            },

            render () {
                //adding reply button html
                this.el.innerHTML = tpl_chatbox(
                    Object.assign(
                        this.model.toJSON(),
                        {'unread_msgs': __('You have unread messages')}
                    )
                );
                this.content = this.el.querySelector('.chat-content');
                var msgs = this.el.querySelectorAll('.chat-msg__body');
                console.log('messages ok');
                console.log(msgs);
                for(var i=0; i < msgs.length; i++){
                    msgs.innerHTML += '<div class="chat-msg__actions"> <button class="chat-msg__action chat-msg__actionreply fas fa-reply" title="{{{o.__(\'Reply this message\')}}}"></button> </div>';
                }
                this.renderMessageForm();
                this.insertHeading();
                return this;
            },
            onMessageReplyButtonClicked(ev){
                console.log('wassup plugin added');
            }
        });

        _converse.api.listen.on('chatBoxViewsInitialized', () => {
            const views = _converse.discussionTrees;
            _converse.chatboxes.on('add', item => {
                if (!views.get(item.get('id')) && item.get('type') === _converse.PRIVATE_CHAT_TYPE) {
                    views.add(item.get('id'), new _converse.discussionTrees({model: item}));
                }
            });
        });

        _converse.api.listen.on('connected', () => {
            // Advertise that we support XEP-0382 Message Spoilers
            _converse.api.disco.own.features.add(Strophe.NS.SPOILER);
        });

        /************************ BEGIN API ************************/
        Object.assign(_converse.api, {
            /**
             * The "chatview" namespace groups methods pertaining to views
             * for one-on-one chats.
             *
             * @namespace _converse.api.chatviews
             * @memberOf _converse.api
             */
            'discussionTrees': {
                 /**
                  * Get the view of an already open chat.
                  */
                'get' (jids) {
                    if (_.isUndefined(jids)) {
                        _converse.log(
                            "chatviews.get: You need to provide at least one JID",
                            Strophe.LogLevel.ERROR
                        );
                        return null;
                    }
                    if (_.isString(jids)) {
                        return _converse.discussionTrees.get(jids);
                    }
                    return _.map(jids, (jid) => _converse.chatboxviews.get(jids));
                }
            }
        });
        /************************ END API ************************/
    }
});
