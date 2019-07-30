// Converse.js
// https://conversejs.org
//
// Copyright (c) 2013-2019, the Converse.js developers
// Licensed under the Mozilla Public License (MPLv2)
/**
 * @module converse-message-view
 */
import URI from "urijs";
import converse from  "@converse/headless/converse-core";
import filesize from "filesize";
import html from "./utils/html";
import tpl_csn from "templates/csn.html";
import tpl_file_progress from "templates/file_progress.html";
import tpl_info from "templates/info.html";
import tpl_message from "templates/message.html";
import tpl_message_versions_modal from "templates/message_versions_modal.html";
import u from "@converse/headless/utils/emoji";
import xss from "xss/dist/xss";

const { Backbone, _, dayjs } = converse.env;


converse.plugins.add('converse-message-view', {

    dependencies: ["converse-modal", "converse-chatboxviews"],

    initialize () {
        /* The initialize function gets called as soon as the plugin is
         * loaded by converse.js's plugin machinery.
         */
        const { _converse } = this;
        const { __ } = _converse;


        function onTagFoundDuringXSSFilter (tag, html, options) {
            /* This function gets called by the XSS library whenever it finds
             * what it thinks is a new HTML tag.
             *
             * It thinks that something like <https://example.com> is an HTML
             * tag and then escapes the <> chars.
             *
             * We want to avoid this, because it prevents these URLs from being
             * shown properly (whithout the trailing &gt;).
             *
             * The URI lib correctly trims a trailing >, but not a trailing &gt;
             */
            if (options.isClosing) {
                // Closing tags don't match our use-case
                return;
            }
            const uri = new URI(tag);
            const protocol = uri.protocol().toLowerCase();
            if (!_.includes(["https", "http", "xmpp", "ftp"], protocol)) {
                // Not a URL, the tag will get filtered as usual
                return;
            }
            if (uri.equals(tag) && `<${tag}>` === html.toLocaleLowerCase()) {
                // We have something like <https://example.com>, and don't want
                // to filter it.
                return html;
            }
        }


        _converse.api.settings.update({
            'show_images_inline': true
        });

        _converse.MessageVersionsModal = _converse.BootstrapModal.extend({
            toHTML () {
                return tpl_message_versions_modal(Object.assign(
                    this.model.toJSON(), {
                    '__': __,
                    'dayjs': dayjs
                }));
            }
        });


        _converse.MessageView = _converse.ViewWithAvatar.extend({

            savedReactions: [],

            events: {
                'click .chat-msg__edit-modal': 'showMessageVersionsModal'
            },

            initialize () {
                this.debouncedRender = _.debounce(() => {
                    // If the model gets destroyed in the meantime,
                    // it no longer has a collection
                    if (this.model.collection) {
                        console.log('msg rendered');
                        console.log(this.model);
                        this.render();
                    }
                }, 50);

                setInterval(() => {
                    //console.log('here');
                    if(this.savedReactions.length > 0)
                    {
                        //console.log('re-rendering reactions');
                        var savedLength = this.savedReactions.length;
                        //console.log(this.savedReactions.length);
                        var currentThis = this.model;
                        for(var i = 0; i < this.savedReactions.length ; i++){
                            //console.log(this.model);
                            this.model = this.savedReactions[i];
                                this.renderReaction();
                        }
                        //console.log('done');
                        this.model = currentThis;
                    }
                }, 2000);

                if (this.model.vcard) {
                    this.model.vcard.on('change', this.debouncedRender, this);
                }

                if (this.model.rosterContactAdded) {
                    this.model.rosterContactAdded.then(() => {
                        this.model.contact.on('change:nickname', this.debouncedRender, this);
                        this.debouncedRender();
                    });
                }

                if (this.model.occupantAdded) {
                    this.model.occupantAdded.then(() => {
                        this.model.occupant.on('change:role', this.debouncedRender, this);
                        this.model.occupant.on('change:affiliation', this.debouncedRender, this);
                        this.debouncedRender();
                    });
                }

                this.model.on('change', this.onChanged, this);
                this.model.on('destroy', this.fadeOut, this);
            },

            async render () {
                //console.log(this.model);
                const is_followup = u.hasClass('chat-msg--followup', this.el);
                if (this.model.isOnlyChatStateNotification()) {
                    this.renderChatStateNotification()
                } else if (this.model.get('file') && !this.model.get('oob_url')) {
                    if (!this.model.file) {
                        _converse.log("Attempted to render a file upload message with no file data");
                        return this.el;
                    }
                    this.renderFileUploadProgresBar();
                } else if (this.model.get('type') === 'error') {
                    this.renderErrorMessage();
                } else if (this.model.get('type') === 'info') {
                    this.renderInfoMessage();
                } else {
                    await this.renderChatMessage();
                }
                if (is_followup) {
                    u.addClass('chat-msg--followup', this.el);
                }

                return this.el;
            },

            async onChanged (item) {
                // Jot down whether it was edited because the `changed`
                // attr gets removed when this.render() gets called further
                // down.
                const edited = item.changed.edited;
                if (this.model.changed.progress) {
                    return this.renderFileUploadProgresBar();
                }
                if (_.filter(['correcting', 'message', 'type', 'upload', 'received'],
                             prop => Object.prototype.hasOwnProperty.call(this.model.changed, prop)).length) {
                    await this.debouncedRender();
                }
                if (edited) {
                    this.onMessageEdited();
                }
            },

            fadeOut () {
                if (_converse.animate) {
                    setTimeout(() => this.remove(), 600);
                    u.addClass('fade-out', this.el);
                } else {
                    this.remove();
                }
            },

            onMessageEdited () {
                console.log('assume');
                if (this.model.get('is_archived')) {
                    return;
                }
                this.el.addEventListener(
                    'animationend',
                    () => u.removeClass('onload', this.el),
                    {'once': true}
                );
                
                    
                u.addClass('onload', this.el);
            },

            replaceElement (msg) {
                if (!_.isNil(this.el.parentElement)) {
                    this.el.parentElement.replaceChild(msg, this.el);
                }
                this.setElement(msg);
                return this.el;
            },

            async renderChatMessage () {
                const is_me_message = this.isMeCommand();
                const time = dayjs(this.model.get('time'));
                const role = this.model.vcard ? this.model.vcard.get('role') : null;
                const roles = role ? role.split(',') : [];
                if(this.model.get('reactsTo')){
                    //console.log('render reaction');
                    this.renderReaction();
                    return;
                 }
                const msg = u.stringToElement(tpl_message(
                    Object.assign(
                        this.model.toJSON(), {
                        '__': __,
                        'is_groupchat_message': this.model.get('type') === 'groupchat',
                        'occupant': this.model.occupant,
                        'is_me_message': is_me_message,
                        'roles': roles,
                        'pretty_time': time.format(_converse.time_format),
                        'time': time.toISOString(),
                        'extra_classes': this.getExtraMessageClasses(),
                        'label_show': __('Show more'),
                        'username': this.model.getDisplayName()
                    })
                ));
                const url = this.model.get('oob_url');
                if (url) {
                    msg.querySelector('.chat-msg__media').innerHTML = _.flow(
                        _.partial(u.renderFileURL, _converse),
                        _.partial(u.renderMovieURL, _converse),
                        _.partial(u.renderAudioURL, _converse),
                        _.partial(u.renderImageURL, _converse))(url);
                }

                let text = this.getMessageText();
                const msg_content = msg.querySelector('.chat-msg__text');
                if (text && text !== url) {
                    if (is_me_message) {
                        text = text.substring(4);
                    }
                    text = xss.filterXSS(text, {'whiteList': {}, 'onTag': onTagFoundDuringXSSFilter});
                    msg_content.innerHTML = _.flow(
                        _.partial(u.geoUriToHttp, _, _converse.geouri_replacement),
                        _.partial(u.addMentionsMarkup, _, this.model.get('references'), this.model.collection.chatbox),
                        u.addHyperlinks,
                        u.renderNewLines,
                        _.partial(u.addEmoji, _converse, _)
                    )(text);
                }
                console.log('of text : ');
                console.log(text);
                console.log(msg);
                if(msg.querySelectorAll('.chat-msg__edit-modal').length > 0){
                    console.log('here');
                    var savedId = this.model.get('msgid');
                    for(var i = 0; i < this.savedReactions.length ; i++){
                        //console.log(this.model);
                        if(this.savedReactions[i].get('reactsTo')==savedId){
                            console.log('alone');
                            console.log(this.savedReactions[i]);
                            this.savedReactions[i].save({
                                'rendered': false
                            });
                        }
                    }
                }
                const promise = u.renderImageURLs(_converse, msg_content);
                if (this.model.get('type') !== 'headline') {
                    this.renderAvatar(msg);
                }
                await promise;
                this.replaceElement(msg);
                //console.log('replaced element');
                //console.log(this.model);
                if (this.model.collection) {
                    // If the model gets destroyed in the meantime, it no
                    // longer has a collection.
                    this.model.collection.trigger('rendered', this);
                }
                 
            },

            renderInfoMessage () {
                const msg = u.stringToElement(
                    tpl_info(Object.assign(this.model.toJSON(), {
                        'extra_classes': 'chat-info',
                        'isodate': dayjs(this.model.get('time')).toISOString()
                    }))
                );
                return this.replaceElement(msg);
            },

            renderErrorMessage () {
                const msg = u.stringToElement(
                    tpl_info(Object.assign(this.model.toJSON(), {
                        'extra_classes': 'chat-error',
                        'isodate': dayjs(this.model.get('time')).toISOString()
                    }))
                );
                return this.replaceElement(msg);
            },

            renderChatStateNotification () {
                let text;
                const from = this.model.get('from'),
                      name = this.model.getDisplayName();

                if (this.model.get('chat_state') === _converse.COMPOSING) {
                    if (this.model.get('sender') === 'me') {
                        text = __('Typing from another device');
                    } else {
                        text = __('%1$s is typing', name);
                    }
                } else if (this.model.get('chat_state') === _converse.PAUSED) {
                    if (this.model.get('sender') === 'me') {
                        text = __('Stopped typing on the other device');
                    } else {
                        text = __('%1$s has stopped typing', name);
                    }
                } else if (this.model.get('chat_state') === _converse.GONE) {
                    text = __('%1$s has gone away', name);
                } else {
                    return;
                }
                const isodate = (new Date()).toISOString();
                this.replaceElement(
                      u.stringToElement(
                        tpl_csn({
                            'message': text,
                            'from': from,
                            'isodate': isodate
                        })));
            },

            renderReaction(msg){
                //console.log('reaction :');
                //console.log(this.model);
                var message = document.querySelectorAll(`[data-msgid="${this.model.get('reactsTo')}"`)? 
                            document.querySelectorAll(`[data-msgid="${this.model.get('reactsTo')}"`): null ;

                //console.log(message);
                /*
                1ST CASE : 
                    div for message is created independently from document
                    the div is to be added later into the document
                */
               //console.log(msg);
                if(msg != undefined && msg != null){  
                    //console.log('im in');
                    var body = msg.querySelectorAll('.chat-msg_content');
                    var callQuits = false;
                    //removing other reactions by same user
                    if(body != null && body != undefined && body.length > 0){
                        var allReacts = body[0].querySelectorAll('.react');
                        //console.log(allReacts);
                        for(var i=0; i < allReacts.length; i++){
                            //console.log(allReacts[i]);
                            var userReacts = allReacts[i].getElementsByTagName('span')[0];
                            if(userReacts.getAttribute('data-reactusers').includes(this.model.get('from'))){
                                userReacts.setAttribute('data-reactusers', userReacts.getAttribute('data-reactusers').replace(this.model.get('from'), ''));
                                if(userReacts.innerHTML == 1){
                                    allReacts[i].parentNode.removeChild(allReacts[i]);
                                    //console.log('div msg new deleted bc no reaction s supoosedtobe there' );
                                }
                                else{
                                    userReacts.innerHTML = parseInt(userReacts.innerHTML) - 1;
                                    //console.log('decreased new');
                                }
                                if(allReacts[i].id == this.model.get('message')){
                                    //console.log('call quits');
                                    callQuits = true;
                                }
                                this.savedReactions[this.savedReactions.indexOf(this.model)].save({
                                    'removed': true
                                });
                            }
                        }

                        if(callQuits){
                            //console.log('do not rerender');
                            this.savedReactions[this.savedReactions.indexOf(this.model)].save({
                                'rendered': true
                            });
                            return;
                        }

                        //adding reaction 
                        var prevReact =  body[0].querySelectorAll('#'+this.model.get('message'));
                        if(prevReact == null || prevReact == undefined || prevReact.length == 0)
                        {
                            var reaction = document.createElement('div');
                            reaction.id = this.model.get('message');
                            reaction.className = "react";
                            //console.log('no prior similar reaction');
                            if(reaction.getAttribute('data-reactionid') == null || reaction.getAttribute('data-reactionid') == undefined){
                                reaction.setAttribute('data-reactionid', this.model.get('msgid'));
                            }
                            else{
                                reaction.setAttribute('data-reactionid', reaction.getAttribute('data-reactionid')+' '+this.model.get('msgid'));
                            }
                            reaction.innerHTML = this.model.get('message') +" +";
                            var counter = document.createElement('span');
                            counter.classList.add(this.model.get('msgid'));
                            counter.setAttribute('data-reactusers', this.model.get('from'));                                    
                            counter.innerHTML = '1';
                            reaction.appendChild(counter);
                            var refNode = body[0].getElementsByClassName("chat-msg__message")[0];
                            // body[0].insertBefore(reaction, refNode.nextSibling);
                            body[0].querySelectorAll('.chat-msg__reacts')[0].appendChild(reaction);
                            this.savedReactions[this.savedReactions.indexOf(this.model)].save({
                                'rendered': true
                            });
                            //console.log('tots rendered');
                            return;
                        } 
                        
                        else {
                            //console.log('prior similar reaction');
                            var counter = prevReact[0].getElementsByTagName('span')[0];
                            if(counter.getAttribute('data-reactusers').includes(this.model.get('from'))){
                                //decrease &erase reaction, erase from savedReactions
                                if(parseInt(counter.innerHTML) == 1){
                                    //console.log('deleted');                                    
                                    prevReact[0].parentNode.removeChild(prevReact[0]);
                                }
                                else{
                                    //console.log('decreased w saaaafi');
                                    counter.innerHTML = parseInt(counter.innerHTML)-1;                                    
                                }
                                counter.setAttribute('data-reactusers', counter.getAttribute('data-reactusers').replace(this.model.get('from'), ''));
                                var indexMsg = this.savedReactions.indexOf(this.model);
                                this.savedReactions[indexMsg].save({
                                    'removed': true
                                });
                                return;
                            }
                            if(counter.classList.contains(this.model.get('msgid'))){
                                //console.log('noooppeee');
                                return; //reaction already rendered
                            }
                            counter.classList.add(this.model.get('msgid'));
                            if(counter.getAttribute('data-reactusers') == null || counter.getAttribute('data-reactusers') == undefined){
                                counter.setAttribute('data-reactusers', this.model.get('from'));
                            }
                            else{
                                counter.setAttribute('data-reactusers', counter.getAttribute('data-reactusers')+' '+this.model.get('from'));
                            }
                            counter.innerHTML = parseInt(counter.innerHTML)+1;
                            this.savedReactions[this.savedReactions.indexOf(this.model)].save({
                                'rendered': true
                            });
                            //console.log('renderé');
                        }
                        return;               
                    }
                    //console.log('must be out');
                    return;
                }

                /*
                2ND CASE : 
                    div for message is added directly to document
                */

                if(document.querySelectorAll(`[data-reactionid="${this.model.get('msgid')}"`)!= null 
                    && document.querySelectorAll(`[data-reactionid="${this.model.get('msgid')}"`)!= undefined
                     && document.querySelectorAll(`[data-reactionid="${this.model.get('msgid')}"`).length > 0){
                    //console.log('no duplicates');
                    return; //reaction aleady rendered : avoiding duplicates
                }

                var existingIndex = undefined;
                for(var i = 0; i < this.savedReactions.length; i++){
                    if(this.savedReactions[i].get('msgid')==this.model.get('msgid')){
                        //console.log('existsss');
                        //console.log(this.savedReactions[i]);
                        existingIndex = i;
                        break;
                    }
                }
                if(existingIndex == undefined){
                    var toSave = this.model;
                    toSave.save({
                        'removed': false,
                        'rendered': false
                    });
                    //console.log(new Array(this.savedReactions));
                    this.savedReactions.push(toSave);
                    //console.log(new Array(this.savedReactions));
                    existingIndex = this.savedReactions.indexOf(toSave);
                }

                //console.log(existingIndex);
                if(existingIndex != -1){
                    //console.log(this.savedReactions[existingIndex]);
                }

                if(message != null && message != undefined && message.length > 0){
                    if(existingIndex != undefined && existingIndex != -1 &&
                    (this.savedReactions[existingIndex].get('rendered')
                    || this.savedReactions[existingIndex].get('removed'))){
                        //console.log('removed or rendered');
                        return;
                    }
                    var body = message[0].querySelectorAll('.chat-msg__content');
                    if(body != null && body != undefined && body.length > 0){
                        var prevReact =  body[0].querySelectorAll('#'+this.model.get('message'));
                        if(prevReact == null || prevReact == undefined || prevReact.length == 0)
                        {
                            //check if there was a prior reaction
                            var allReacts = body[0].querySelectorAll('.react');
                            //console.log(allReacts);
                            for(var i=0; i < allReacts.length; i++){
                                var savedData = {
                                    'reaction': allReacts[i].id,
                                    'from': this.model.get('from'),
                                    'to': this.model.get('jid'),
                                    'msg': this.model.get('reactsTo')
                                };
                                //console.log(allReacts[i]);
                                var userReacts = allReacts[i].getElementsByTagName('span')[0];
                                if(userReacts.getAttribute('data-reactusers').includes(this.model.get('from'))){
                                    userReacts.setAttribute('data-reactusers', userReacts.getAttribute('data-reactusers').replace(this.model.get('from'), ''));
                                    if(userReacts.innerHTML == 1){
                                        allReacts[i].parentNode.removeChild(allReacts[i]);
                                        //console.log('div msg new deleted' );
                                    }
                                    else{
                                        userReacts.innerHTML = parseInt(userReacts.innerHTML) - 1;
                                        //console.log('decreased now');
                                    }
                                    for(var i = 0; i < this.savedReactions.length; i++){
                                        if(this.savedReactions[i].get('from')==savedData.from 
                                        && this.savedReactions[i].get('message')==savedData.message
                                        && this.savedReactions[i].get('jid')==savedData.to
                                        && this.savedReactions[i].get('reactsTo')==savedData.reactsTo){
                                            this.savedReactions[i].save({
                                                'removed': true
                                            });
                                        }
                                    }
                                }
                            }
                            //console.log('no prior similar reaction');
                            var reaction = document.createElement('div');
                            reaction.id = this.model.get('message');
                            reaction.className = "react";
                            reaction.setAttribute('data-reactionid', this.model.get('msgid'));
                            reaction.innerHTML = this.model.get('message') +" +";
                            var counter = document.createElement('span');
                            counter.classList.add(this.model.get('msgid'));
                            counter.setAttribute('data-reactusers', this.model.get('from'));                                    
                            counter.innerHTML = '1';
                            reaction.appendChild(counter);
                            var refNode = body[0].getElementsByClassName("chat-msg__message")[0];
                            // body[0].insertBefore(reaction, refNode.nextSibling);
                            body[0].querySelectorAll('.chat-msg__reacts')[0].appendChild(reaction);
                            this.savedReactions[this.savedReactions.indexOf(this.model)].save({
                                'rendered': true
                            });
                        } else {
                            //console.log('prior reaction');
                            //check if there was a prior reaction
                            var callQuits = false;
                            var allReacts = body[0].querySelectorAll('.react');
                            //console.log(allReacts);
                            for(var i=0; i < allReacts.length; i++){
                                var savedData = {
                                    'reaction': allReacts[i].id,
                                    'from': this.model.get('from'),
                                    'to': this.model.get('jid'),
                                    'msg': this.model.get('reactsTo')
                                };
                                //console.log(allReacts[i]);
                                var userReacts = allReacts[i].getElementsByTagName('span')[0];
                                if(userReacts.getAttribute('data-reactusers').includes(this.model.get('from'))){
                                    if(allReacts[i].id == this.model.get('message'))
                                    {
                                        this.savedReactions[this.savedReactions.indexOf(this.model)].save({
                                            'removed': true
                                        });
                                        callQuits = true;
                                    }
                                    userReacts.setAttribute('data-reactusers', userReacts.getAttribute('data-reactusers').replace(this.model.get('from'), ''));
                                    if(userReacts.innerHTML == 1){
                                        allReacts[i].parentNode.removeChild(allReacts[i]);
                                        //console.log('div msg new deleted bc no reaction s supoosedtobe there' );
                                    }
                                    else{
                                        userReacts.innerHTML = parseInt(userReacts.innerHTML) - 1;
                                        //console.log('decreased new');
                                    }
                                    for(var i = 0; i < this.savedReactions.length; i++){
                                        if(this.savedReactions[i].get('from')==savedData.from 
                                        && this.savedReactions[i].get('message')==savedData.message
                                        && this.savedReactions[i].get('jid')==savedData.to
                                        && this.savedReactions[i].get('reactsTo')==savedData.reactsTo){
                                            this.savedReactions[i].save({
                                                'removed': true
                                            });
                                        }

                                    }
                                }
                            }
                            if(callQuits){
                                this.savedReactions[this.savedReactions.indexOf(this.model)].save({
                                    'removed': true
                                });
                                //console.log('removing reaction');
                                return;
                            }
                            var counter = prevReact[0].getElementsByTagName('span')[0];
                            if(counter.classList.contains(this.model.get('msgid'))){
                                //console.log('nopeee');
                                return; //reaction already rendered
                            }
                            counter.classList.add(this.model.get('msgid'));
                            if(counter.getAttribute('data-reactusers') == null || counter.getAttribute('data-reactusers') == undefined){
                                counter.setAttribute('data-reactusers', this.model.get('from'));
                            }
                            else{
                                counter.setAttribute('data-reactusers', counter.getAttribute('data-reactusers')+' '+this.model.get('from'));
                            }
                            //console.log('regular');
                            counter.innerHTML = parseInt(counter.innerHTML)+1;
                            this.savedReactions[this.savedReactions.indexOf(this.model)].save({
                                'rendered': true
                            });
                        }
                    }
                }else{
                    //console.log('here :(');
                    return; //message to which the reaction is destined doesn't exist on document
                }
            },

            renderFileUploadProgresBar () {
                const msg = u.stringToElement(tpl_file_progress(
                    Object.assign(this.model.toJSON(), {
                        '__': __,
                        'filename': this.model.file.name,
                        'filesize': filesize(this.model.file.size)
                    })));
                this.replaceElement(msg);
                this.renderAvatar();
            },

            showMessageVersionsModal (ev) {
                ev.preventDefault();
                if (this.model.message_versions_modal === undefined) {
                    this.model.message_versions_modal = new _converse.MessageVersionsModal({'model': this.model});
                }
                this.model.message_versions_modal.show(ev);
            },

            getMessageText () {
                if (this.model.get('is_encrypted')) {
                    return this.model.get('plaintext') ||
                           (_converse.debug ? __('Unencryptable OMEMO message') : null);
                }
                return this.model.get('message');
            },

            isMeCommand () {
                const text = this.getMessageText();
                if (!text) {
                    return false;
                }
                return text.startsWith('/me ');
            },

            processMessageText () {
                var text = this.get('message');
                text = u.geoUriToHttp(text, _converse.geouri_replacement);
            },

            getExtraMessageClasses () {
                let extra_classes = this.model.get('is_delayed') && 'delayed' || '';

                if (this.model.get('type') === 'groupchat') {
                    if (this.model.occupant) {
                        extra_classes += ` ${this.model.occupant.get('role') || ''} ${this.model.occupant.get('affiliation') || ''}`;
                    }
                    if (this.model.get('sender') === 'them' && this.model.collection.chatbox.isUserMentioned(this.model)) {
                        // Add special class to mark groupchat messages
                        // in which we are mentioned.
                        extra_classes += ' mentioned';
                    }
                }
                if (this.model.get('correcting')) {
                    extra_classes += ' correcting';
                }
                return extra_classes;
            }
        });
    }
});
