
(function( $ ){
/**
 *
 * The main point of entry into creating a zoomable image on the page.
 *
 * We have provided an idiomatic javascript constructor which takes
 * a single object, but still support the legacy positional arguments.
 *
 * The options below are given in order that they appeared in the constructor
 * as arguments and we translate a positional call into an idiomatic call.
 *
 * @class
 * @extends OpenSeadragon.EventHandler
 * @param {Object} options
 * @param {String} options.element Id of Element to attach to,
 * @param {String} options.xmlPath  Xpath ( TODO: not sure! ),
 * @param {String} options.prefixUrl  Url used to prepend to paths, eg button 
 *  images, etc.
 * @param {Seadragon.Controls[]} options.controls Array of Seadragon.Controls,
 * @param {Seadragon.Overlays[]} options.overlays Array of Seadragon.Overlays,
 * @param {Seadragon.Controls[]} options.overlayControls An Array of ( TODO: 
 *  not sure! )
 *
 **/    
$.Viewer = function( options ) {

    var args  = arguments,
        _this = this,
        i;

    $.EventHandler.call( this );

    if( typeof( options ) != 'object' ){
        options = {
            id:                 args[ 0 ],
            xmlPath:            args.length > 1 ? args[ 1 ] : undefined,
            prefixUrl:          args.length > 2 ? args[ 2 ] : undefined,
            controls:           args.length > 3 ? args[ 3 ] : undefined,
            overlays:           args.length > 4 ? args[ 4 ] : undefined,
            overlayControls:    args.length > 5 ? args[ 5 ] : undefined,
            config:             {}
        };
    }
    
    //Allow the options object to override global defaults
    $.extend( true, this, { 
        id:                 options.id,
        xmlPath:            null,
        prefixUrl:          '',
        controls:           [],
        overlays:           [],
        overlayControls:    [],
        config: {
            debugMode:          true,
            animationTime:      1.5,
            blendTime:          0.5,
            alwaysBlend:        false,
            autoHideControls:   true,
            immediateRender:    false,
            wrapHorizontal:     false,
            wrapVertical:       false,
            minZoomImageRatio:  0.8,
            maxZoomPixelRatio:  2,
            visibilityRatio:    0.5,
            springStiffness:    5.0,
            imageLoaderLimit:   0,
            clickTimeThreshold: 200,
            clickDistThreshold: 5,
            zoomPerClick:       2.0,
            zoomPerScroll:      1.2,
            zoomPerSecond:      2.0,
            showNavigationControl: true,
            maxImageCacheCount: 100,
            minPixelRatio:      0.5,
            mouseNavEnabled:    true,
            navImages: {
                zoomIn: {
                    REST:   '/images/zoomin_rest.png',
                    GROUP:  '/images/zoomin_grouphover.png',
                    HOVER:  '/images/zoomin_hover.png',
                    DOWN:   '/images/zoomin_pressed.png'
                },
                zoomOut: {
                    REST:   '/images/zoomout_rest.png',
                    GROUP:  '/images/zoomout_grouphover.png',
                    HOVER:  '/images/zoomout_hover.png',
                    DOWN:   '/images/zoomout_pressed.png'
                },
                home: {
                    REST:   '/images/home_rest.png',
                    GROUP:  '/images/home_grouphover.png',
                    HOVER:  '/images/home_hover.png',
                    DOWN:   '/images/home_pressed.png'
                },
                fullpage: {
                    REST:   '/images/fullpage_rest.png',
                    GROUP:  '/images/fullpage_grouphover.png',
                    HOVER:  '/images/fullpage_hover.png',
                    DOWN:   '/images/fullpage_pressed.png'
                }
            }
        },

        //These were referenced but never defined
        controlsFadeDelay:  2000,
        controlsFadeLength: 1500,

        //These are originally not part options but declared as members
        //in initialize.  Its still considered idiomatic to put them here
        source:     null,
        drawer:     null,
        drawers:    [],
        viewport:   null,
        profiler:   null,

        //This was originally initialized in the constructor and so could never
        //have anything in it.  now it can because we allow it to be specified
        //in the options and is only empty by default if not specified. Also
        //this array was returned from get_controls which I find confusing
        //since this object has a controls property which is treated in other
        //functions like clearControls.  I'm removing the accessors.
        customControls: []

    }, options );

    this.element        = document.getElementById( options.id );
    this.container      = $.makeNeutralElement( "div" );
    this.canvas         = $.makeNeutralElement( "div" );

    //Used for toggling between fullscreen and default container size
    this.bodyWidth      = document.body.style.width;
    this.bodyHeight     = document.body.style.height;
    this.bodyOverflow   = document.body.style.overflow;
    this.docOverflow    = document.documentElement.style.overflow;
    this.previousBody   = [];

    this._fsBoundsDelta     = new $.Point( 1, 1 );
    this._prevContainerSize = null;
    this._lastOpenStartTime = 0;
    this._lastOpenEndTime   = 0;
    this._animating         = false;
    this._forceRedraw       = false;
    this._mouseInside       = false;

    this.innerTracker = new $.MouseTracker({
        element:            this.canvas, 
        clickTimeThreshold: this.config.clickTimeThreshold, 
        clickDistThreshold: this.config.clickDistThreshold,
        clickHandler:       $.delegate( this, onCanvasClick ),
        dragHandler:        $.delegate( this, onCanvasDrag ),
        releaseHandler:     $.delegate( this, onCanvasRelease ),
        scrollHandler:      $.delegate( this, onCanvasScroll )
    }).setTracking( true ); // default state

    this.outerTracker = new $.MouseTracker({
        element:            this.container, 
        clickTimeThreshold: this.config.clickTimeThreshold, 
        clickDistThreshold: this.config.clickDistThreshold,
        enterHandler:       $.delegate( this, onContainerEnter ),
        exitHandler:        $.delegate( this, onContainerExit ),
        releaseHandler:     $.delegate( this, onContainerRelease )
    }).setTracking( true ); // always tracking

    (function( canvas ){
        canvas.width    = "100%";
        canvas.height   = "100%";
        canvas.overflow = "hidden";
        canvas.position = "absolute";
        canvas.top      = "0px";
        canvas.left     = "0px";
    }(  this.canvas.style ));


    (function( container ){
        container.width     = "100%";
        container.height    = "100%";
        container.position  = "relative";
        container.left      = "0px";
        container.top       = "0px";
        container.textAlign = "left";  // needed to protect against
    }( this.container.style ));

    var layouts = [ 'topleft', 'topright', 'bottomright', 'bottomleft'],
        layout;

    for( i = 0; i < layouts.length; i++ ){
        layout = layouts[ i ]
        this.controls[ layout ] = $.makeNeutralElement( "div" );
        this.controls[ layout ].style.position = 'absolute';
        if ( layout.match( 'left' ) ){
            this.controls[ layout ].style.left = '0px';
        }
        if ( layout.match( 'right' ) ){
            this.controls[ layout ].style.right = '0px';
        }
        if ( layout.match( 'top' ) ){
            this.controls[ layout ].style.top = '0px';
        }
        if ( layout.match( 'bottom' ) ){
            this.controls[ layout ].style.bottom = '0px';
        }
    }

    //////////////////////////////////////////////////////////////////////////
    // Navigation Controls
    //////////////////////////////////////////////////////////////////////////
    this._group         = null; 
    // whether we should be continuously zooming
    this._zooming       = false;
    // how much we should be continuously zooming by
    this._zoomFactor    = null;  
    this._lastZoomTime  = null;
    
    var beginZoomingInHandler   = $.delegate( this, beginZoomingIn ),
        endZoomingHandler       = $.delegate( this, endZooming ),
        doSingleZoomInHandler   = $.delegate( this, doSingleZoomIn ),
        beginZoomingOutHandler  = $.delegate( this, beginZoomingOut ),
        doSingleZoomOutHandler  = $.delegate( this, doSingleZoomOut ),
        onHomeHandler           = $.delegate( this, onHome ),
        onFullPageHandler       = $.delegate( this, onFullPage ),
        navImages               = this.config.navImages,
        zoomIn = new $.Button({ 
            config:     this.config, 
            tooltip:    $.getString( "Tooltips.ZoomIn" ), 
            srcRest:    resolveUrl( this.urlPrefix, navImages.zoomIn.REST ),
            srcGroup:   resolveUrl( this.urlPrefix, navImages.zoomIn.GROUP ),
            srcHover:   resolveUrl( this.urlPrefix, navImages.zoomIn.HOVER ),
            srcDown:    resolveUrl( this.urlPrefix, navImages.zoomIn.DOWN ),
            onPress:    beginZoomingInHandler,
            onRelease:  endZoomingHandler,
            onClick:    doSingleZoomInHandler,
            onEnter:    beginZoomingInHandler,
            onExit:     endZoomingHandler
        }),
        zoomOut = new $.Button({ 
            config:     this.config, 
            tooltip:    $.getString( "Tooltips.ZoomOut" ), 
            srcRest:    resolveUrl( this.urlPrefix, navImages.zoomOut.REST ), 
            srcGroup:   resolveUrl( this.urlPrefix, navImages.zoomOut.GROUP ), 
            srcHover:   resolveUrl( this.urlPrefix, navImages.zoomOut.HOVER ), 
            srcDown:    resolveUrl( this.urlPrefix, navImages.zoomOut.DOWN ),
            onPress:    beginZoomingOutHandler, 
            onRelease:  endZoomingHandler, 
            onClick:    doSingleZoomOutHandler, 
            onEnter:    beginZoomingOutHandler, 
            onExit:     endZoomingHandler 
        }),
        goHome = new $.Button({ 
            config:     this.config, 
            tooltip:    $.getString( "Tooltips.Home" ), 
            srcRest:    resolveUrl( this.urlPrefix, navImages.home.REST ), 
            srcGroup:   resolveUrl( this.urlPrefix, navImages.home.GROUP ), 
            srcHover:   resolveUrl( this.urlPrefix, navImages.home.HOVER ), 
            srcDown:    resolveUrl( this.urlPrefix, navImages.home.DOWN ),
            onRelease:  onHomeHandler 
        }),
        fullPage = new $.Button({ 
            config:     this.config, 
            tooltip:    $.getString( "Tooltips.FullPage" ),
            srcRest:    resolveUrl( this.urlPrefix, navImages.fullpage.REST ),
            srcGroup:   resolveUrl( this.urlPrefix, navImages.fullpage.GROUP ),
            srcHover:   resolveUrl( this.urlPrefix, navImages.fullpage.HOVER ),
            srcDown:    resolveUrl( this.urlPrefix, navImages.fullpage.DOWN ),
            onRelease:  onFullPageHandler 
        });

    this.buttons = new $.ButtonGroup({ 
        config:     this.config, 
        buttons:    [ zoomIn, zoomOut, goHome, fullPage ] 
    });

    this.navControl  = this.buttons.element;
    this.navControl[ $.SIGNAL ] = true;   // hack to get our controls to fade
    this.addHandler( 'open', $.delegate( this, lightUp ) );

    if ( this.config.showNavigationControl ) {
        this.navControl.style.marginRight = "4px";
        this.navControl.style.marginBottom = "4px";
        this.addControl(this.navControl, $.ControlAnchor.BOTTOM_RIGHT);
    }

    for ( i = 0; i < this.customControls.length; i++ ) {
        this.addControl(
            this.customControls[ i ].id, 
            this.customControls[ i ].anchor
        );
    }

    this.container.appendChild( this.canvas );
    this.container.appendChild( this.controls.topleft );
    this.container.appendChild( this.controls.topright );
    this.container.appendChild( this.controls.bottomright );
    this.container.appendChild( this.controls.bottomleft );
    this.element.appendChild( this.container );

    window.setTimeout( function(){
        beginControlsAutoHide( _this );
    }, 1 );    // initial fade out

    if ( this.xmlPath ){
        this.openDzi( this.xmlPath );
    }
};

$.extend( $.Viewer.prototype, $.EventHandler.prototype, {

    /**
     * @function
     * @name OpenSeadragon.Viewer.prototype.addControl
     */
    addControl: function ( element, anchor ) {
        var element = $.getElement( element ),
            div = null;

        if ( getControlIndex( this, element ) >= 0 ) {
            return;     // they're trying to add a duplicate control
        }

        switch ( anchor ) {
            case $.ControlAnchor.TOP_RIGHT:
                div = this.controls.topright;
                element.style.position = "relative";
                break;
            case $.ControlAnchor.BOTTOM_RIGHT:
                div = this.controls.bottomright;
                element.style.position = "relative";
                break;
            case $.ControlAnchor.BOTTOM_LEFT:
                div = this.controls.bottomleft;
                element.style.position = "relative";
                break;
            case $.ControlAnchor.TOP_LEFT:
                div = this.controls.topleft;
                element.style.position = "relative";
                break;
            case $.ControlAnchor.NONE:
            default:
                div = this.container;
                element.style.position = "absolute";
                break;
        }

        this.controls.push(
            new $.Control( element, anchor, div )
        );
        element.style.display = "inline-block";
    },

    /**
     * @function
     * @name OpenSeadragon.Viewer.prototype.isOpen
     * @return {Boolean}
     */
    isOpen: function () {
        return !!this.source;
    },

    /**
     * If the string is xml is simply parsed and opened, otherwise the string 
     * is treated as an URL and an xml document is requested via ajax, parsed 
     * and then opened in the viewer.
     * @function
     * @name OpenSeadragon.Viewer.prototype.openDzi
     * @param {String} dzi and xml string or the url to a DZI xml document.
     * @return {OpenSeadragon.Viewer} Chainable.
     */
    openDzi: function ( dzi ) {
        var _this = this;
        $.createFromDZI(
            dzi,
            function( source ){
               _this.open( source );
            }
        );
        return this;
    },

    /**
     * @function
     * @name OpenSeadragon.Viewer.prototype.openTileSource
     * @return {OpenSeadragon.Viewer} Chainable.
     */
    openTileSource: function ( tileSource ) {
        var _this = this;
        window.setTimeout( function () {
            _this.open( tileSource );
        }, 1 );
        return this;
    },

    /**
     * @function
     * @name OpenSeadragon.Viewer.prototype.open
     * @return {OpenSeadragon.Viewer} Chainable.
     */
    open: function( source ) {
        var _this = this,
            overlay,
            i;

        if ( this.source ) {
            this.close();
        }
        
        // to ignore earlier opens
        this._lastOpenStartTime = +new Date();

        window.setTimeout( function () {
            if ( _this._lastOpenStartTime > _this._lastOpenEndTime ) {
                _this._setMessage( $.getString( "Messages.Loading" ) );
            }
        }, 2000);

        this._lastOpenEndTime = +new Date();
        this.canvas.innerHTML = "";
        this._prevContainerSize = $.getElementSize( this.container );

        if( source ){
            this.source = source;
        }
        this.viewport = new $.Viewport( 
            this._prevContainerSize, 
            this.source.dimensions, 
            this.config
        );
        this.drawer = new $.Drawer(
            this.source, 
            this.viewport, 
            this.canvas
        );
        this.drawers.push( this.drawer );

        //this.profiler = new $.Profiler();

        this._animating = false;
        this._forceRedraw = true;
        scheduleUpdate( this, updateMulti );

        for ( i = 0; i < this.overlayControls.length; i++ ) {
            
            overlay = this.overlayControls[ i ];
            
            if ( overlay.point != null ) {
            
                this.drawer.addOverlay(
                    overlay.id, 
                    new $.Point( 
                        overlay.point.X, 
                        overlay.point.Y 
                    ), 
                    $.OverlayPlacement.TOP_LEFT
                );
            
            } else {
            
                this.drawer.addOverlay(
                    overlay.id, 
                    new $.Rect(
                        overlay.rect.Point.X, 
                        overlay.rect.Point.Y, 
                        overlay.rect.Width, 
                        overlay.rect.Height
                    ), 
                    overlay.placement
                );
            
            }
        }
        this.raiseEvent( "open" );
        return this;
    },

    /**
     * @function
     * @name OpenSeadragon.Viewer.prototype.close
     * @return {OpenSeadragon.Viewer} Chainable.
     */
    close: function () {
        this.source     = null;
        this.viewport   = null;
        this.drawer     = null;
        this.drawers    = [];
        //this.profiler   = null;
        this.canvas.innerHTML = "";
        return this;
    },

    /**
     * @function
     * @name OpenSeadragon.Viewer.prototype.removeControl
     * @return {OpenSeadragon.Viewer} Chainable.
     */
    removeControl: function ( element ) {
        
        var element = $.getElement( element ),
            i    = getControlIndex( this, element );
        
        if ( i >= 0 ) {
            this.controls[ i ].destroy();
            this.controls.splice( i, 1 );
        }

        return this;
    },

    /**
     * @function
     * @name OpenSeadragon.Viewer.prototype.clearControls
     * @return {OpenSeadragon.Viewer} Chainable.
     */
    clearControls: function () {
        while ( this.controls.length > 0 ) {
            this.controls.pop().destroy();
        }
        return this;
    },

    /**
     * @function
     * @name OpenSeadragon.Viewer.prototype.isDashboardEnabled
     * @return {Boolean}
     */
    isDashboardEnabled: function () {
        var i;
        
        for ( i = this.controls.length - 1; i >= 0; i-- ) {
            if ( this.controls[ i ].isVisible() ) {
                return true;
            }
        }

        return false;
    },

    /**
     * @function
     * @name OpenSeadragon.Viewer.prototype.isFullPage
     * @return {Boolean}
     */
    isFullPage: function () {
        return this.container.parentNode == document.body;
    },

    /**
     * @function
     * @name OpenSeadragon.Viewer.prototype.isMouseNavEnabled
     * @return {Boolean}
     */
    isMouseNavEnabled: function () {
        return this.innerTracker.isTracking();
    },

    /**
     * @function
     * @name OpenSeadragon.Viewer.prototype.isVisible
     * @return {Boolean}
     */
    isVisible: function () {
        return this.container.style.visibility != "hidden";
    },

    /**
     * @function
     * @name OpenSeadragon.Viewer.prototype.setDashboardEnabled
     * @return {OpenSeadragon.Viewer} Chainable.
     */
    setDashboardEnabled: function( enabled ) {
        var i;
        for ( i = this.controls.length - 1; i >= 0; i-- ) {
            this.controls[ i ].setVisible( enabled );
        }
        return this;
    },

    /**
     * Toggle full page mode.
     * @function
     * @name OpenSeadragon.Viewer.prototype.setFullPage
     * @param {Boolean} fullPage
     *      If true, enter full page mode.  If false, exit full page mode.
     * @return {OpenSeadragon.Viewer} Chainable.
     */
    setFullPage: function( fullPage ) {

        var body            = document.body,
            bodyStyle       = body.style,
            docStyle        = document.documentElement.style,
            containerStyle  = this.container.style,
            canvasStyle     = this.canvas.style,
            oldBounds,
            newBounds,
            nodes,
            i;
        
        //dont bother modifying the DOM if we are already in full page mode.
        if ( fullPage == this.isFullPage() ) {
            return;
        }

        if ( fullPage ) {
            
            this.bodyOverflow   = bodyStyle.overflow;
            this.docOverflow    = docStyle.overflow;
            bodyStyle.overflow  = "hidden";
            docStyle.overflow   = "hidden";

            this.bodyWidth      = bodyStyle.width;
            this.bodyHeight     = bodyStyle.height;
            bodyStyle.width     = "100%";
            bodyStyle.height    = "100%";

            canvasStyle.backgroundColor = "black";
            canvasStyle.color           = "white";

            containerStyle.position = "fixed";
            containerStyle.zIndex   = "99999999";

            //when entering full screen on the ipad it wasnt sufficient to leave
            //the body intact as only only the top half of the screen would 
            //respond to touch events on the canvas, while the bottom half treated
            //them as touch events on the document body.  Thus we remove and store
            //the bodies elements and replace them when we leave full screen.
            this.previousBody = [];
            nodes = document.body.childNodes.length;
            for ( i = 0; i < nodes; i ++ ){
                this.previousBody.push( document.body.childNodes[ 0 ] );
                document.body.removeChild( document.body.childNodes[ 0 ] );
            }
            body.appendChild( this.container );
            this._prevContainerSize = $.getWindowSize();

            // mouse will be inside container now
            $.delegate( this, onContainerEnter )();    


        } else {
            
            bodyStyle.overflow  = this.bodyOverflow;
            docStyle.overflow   = this.docOverflow;

            bodyStyle.width     = this.bodyWidth;
            bodyStyle.height    = this.bodyHeight;

            canvasStyle.backgroundColor = "";
            canvasStyle.color           = "";

            containerStyle.position = "relative";
            containerStyle.zIndex   = "";

            document.body.removeChild( this.container );
            nodes = this.previousBody.length;
            for ( i = 0; i < nodes; i++ ){
                document.body.appendChild( this.previousBody.shift() );
            }
            this.element.appendChild( this.container );
            this._prevContainerSize = $.getElementSize( this.element );
            
            // mouse will likely be outside now
            $.delegate( this, onContainerExit )();      

        }

        if ( this.viewport ) {
            oldBounds = this.viewport.getBounds();
            this.viewport.resize( this._prevContainerSize );
            newBounds = this.viewport.getBounds();

            if ( fullPage ) {
                this._fsBoundsDelta = new $.Point(
                    newBounds.width  / oldBounds.width,
                    newBounds.height / oldBounds.height
                );
            } else {
                this.viewport.update();
                this.viewport.zoomBy(
                    Math.max( 
                        this._fsBoundsDelta.x, 
                        this._fsBoundsDelta.y 
                    ),
                    null, 
                    true
                );
            }

            this._forceRedraw = true;
            this.raiseEvent( "resize", this );
            updateOnce( this );
        }
        return this;
    },

    /**
     * @function
     * @name OpenSeadragon.Viewer.prototype.setMouseNavEnabled
     * @return {OpenSeadragon.Viewer} Chainable.
     */
    setMouseNavEnabled: function( enabled ){
        this.innerTracker.setTracking( enabled );
        return this;
    },

    /**
     * @function
     * @name OpenSeadragon.Viewer.prototype.setVisible
     * @return {OpenSeadragon.Viewer} Chainable.
     */
    setVisible: function( visible ){
        this.container.style.visibility = visible ? "" : "hidden";
        return this;
    }

    /**
     * @function
     * @name OpenSeadragon.Viewer.prototype.addLayer
     */
    addLayer : function( tileSource ) {

        var drawer = new $.Drawer(
            tileSource, 
            this.viewport, 
            this.canvas
        );

        this.drawers.push( drawer );

        updateOnce( this );

        return drawer.canvas;
	}
	
});

///////////////////////////////////////////////////////////////////////////////
// Schedulers provide the general engine for animation
///////////////////////////////////////////////////////////////////////////////

function scheduleUpdate( viewer, updateFunc, prevUpdateTime ){
    var currentTime,
        targetTime,
        deltaTime;

    if ( this._animating ) {
        return window.setTimeout( function(){
            updateFunc( viewer );
        }, 1 );
    }

    currentTime     = +new Date();
    prevUpdateTime  = prevUpdateTime ? prevUpdateTime : currentTime;
    // 60 frames per second is ideal
    targetTime      = prevUpdateTime + 1000 / 60;
    deltaTime       = Math.max( 1, targetTime - currentTime );
    
    return window.setTimeout( function(){
        updateFunc( viewer );
    }, deltaTime );
};

//provides a sequence in the fade animation
function scheduleControlsFade( viewer ) {
    window.setTimeout( function(){
        updateControlsFade( viewer );
    }, 20);
};

//initiates an animation to hide the controls
function beginControlsAutoHide( viewer ) {
    if ( !viewer.config.autoHideControls ) {
        return;
    }
    viewer.controlsShouldFade = true;
    viewer.controlsFadeBeginTime = 
        +new Date() + 
        viewer.controlsFadeDelay;

    window.setTimeout( function(){
        scheduleControlsFade( viewer );
    }, viewer.controlsFadeDelay );
};


//determines if fade animation is done or continues the animation
function updateControlsFade( viewer ) {
    var currentTime,
        deltaTime,
        opacity,
        i;
    if ( viewer.controlsShouldFade ) {
        currentTime = new Date().getTime();
        deltaTime = currentTime - viewer.controlsFadeBeginTime;
        opacity = 1.0 - deltaTime / viewer.controlsFadeLength;

        opacity = Math.min( 1.0, opacity );
        opacity = Math.max( 0.0, opacity );

        for ( i = viewer.controls.length - 1; i >= 0; i--) {
            viewer.controls[ i ].setOpacity( opacity );
        }

        if ( opacity > 0 ) {
            // fade again
            scheduleControlsFade( viewer ); 
        }
    }
};

//stop the fade animation on the controls and show them
function abortControlsAutoHide( viewer ) {
    var i;
    viewer.controlsShouldFade = false;
    for ( i = viewer.controls.length - 1; i >= 0; i-- ) {
        viewer.controls[ i ].setOpacity( 1.0 );
    }
};


///////////////////////////////////////////////////////////////////////////////
// Default view event handlers.
///////////////////////////////////////////////////////////////////////////////
function onCanvasClick( tracker, position, quick, shift ) {
    var zoomPreClick,
        factor;
    if ( this.viewport && quick ) {    // ignore clicks where mouse moved         
        zoomPerClick = this.config.zoomPerClick;
        factor = shift ? 1.0 / zoomPerClick : zoomPerClick;
        this.viewport.zoomBy(
            factor, 
            this.viewport.pointFromPixel( position, true )
        );
        this.viewport.applyConstraints();
    }
};

function onCanvasDrag( tracker, position, delta, shift ) {
    if ( this.viewport ) {
        this.viewport.panBy( 
            this.viewport.deltaPointsFromPixels( 
                delta.negate() 
            ) 
        );
    }
};

function onCanvasRelease( tracker, position, insideElementPress, insideElementRelease ) {
    if ( insideElementPress && this.viewport ) {
        this.viewport.applyConstraints();
    }
};

function onCanvasScroll( tracker, position, scroll, shift ) {
    var factor;
    if ( this.viewport ) {
        factor = Math.pow( this.config.zoomPerScroll, scroll );
        this.viewport.zoomBy( 
            factor, 
            this.viewport.pointFromPixel( position, true ) 
        );
        this.viewport.applyConstraints();
    }
};

function onContainerExit( tracker, position, buttonDownElement, buttonDownAny ) {
    if ( !buttonDownElement ) {
        this._mouseInside = false;
        if ( !this._animating ) {
            beginControlsAutoHide( this );
        }
    }
};

function onContainerRelease( tracker, position, insideElementPress, insideElementRelease ) {
    if ( !insideElementRelease ) {
        this._mouseInside = false;
        if ( !this._animating ) {
            beginControlsAutoHide( this );
        }
    }
};

function onContainerEnter( tracker, position, buttonDownElement, buttonDownAny ) {
    this._mouseInside = true;
    abortControlsAutoHide( this );
};

///////////////////////////////////////////////////////////////////////////////
// Utility methods
///////////////////////////////////////////////////////////////////////////////
function getControlIndex( viewer, element ) {
    for ( i = viewer.controls.length - 1; i >= 0; i-- ) {
        if ( viewer.controls[ i ].element == element ) {
            return i;
        }
    }
    return -1;
};


///////////////////////////////////////////////////////////////////////////////
// Page update routines ( aka Views - for future reference )
///////////////////////////////////////////////////////////////////////////////

function updateMulti( viewer ) {

    var beginTime;

    if ( !viewer.source ) {
        return;
    }

    beginTime = +new Date();
    updateOnce( viewer );
    scheduleUpdate( viewer, arguments.callee, beginTime );
};

function updateOnce( viewer ) {

    var containerSize,
        animated;

    if ( !viewer.source ) {
        return;
    }

    //viewer.profiler.beginUpdate();

    containerSize = $.getElementSize( viewer.container );
    if ( !containerSize.equals( viewer._prevContainerSize ) ) {
        // maintain image position
        viewer.viewport.resize( containerSize, true ); 
        viewer._prevContainerSize = containerSize;
        viewer.raiseEvent( "resize" );
    }

    animated = viewer.viewport.update();
    if ( !viewer._animating && animated ) {
        viewer.raiseEvent( "animationstart" );
        abortControlsAutoHide( viewer );
    }

	function updateDrawers() {
		var i, numDrawers = viewer.drawers.length;
		for (i = 0; i < numDrawers; i+=1) {
			viewer.drawers[i].update();			
		}
	}

	function drawersNeedUpdate() {
		var i, numDrawers = viewer.drawers.length;
		for (i = 0; i < numDrawers; i+=1) {
			if (viewer.drawers[i].needsUpdate()) {
				return true;
			};			
		}
		return false;
	}
	
    if ( animated ) {
        updateDrawers();
        viewer.raiseEvent( "animation" );
    } else if ( viewer._forceRedraw || drawersNeedUpdate() ) {
        updateDrawers();
        viewer._forceRedraw = false;
    } 

    if ( viewer._animating && !animated ) {
        viewer.raiseEvent( "animationfinish" );

        if ( !viewer._mouseInside ) {
            beginControlsAutoHide( viewer );
        }
    }

    viewer._animating = animated;

    //viewer.profiler.endUpdate();
};

///////////////////////////////////////////////////////////////////////////////
// Navigation Controls
///////////////////////////////////////////////////////////////////////////////

function resolveUrl( prefix, url ) {
    return prefix ? prefix + url : url;
};


function beginZoomingIn() {
    this._lastZoomTime = +new Date();
    this._zoomFactor = this.config.zoomPerSecond;
    this._zooming = true;
    scheduleZoom( this );
}

function beginZoomingOut() {
    this._lastZoomTime = +new Date();
    this._zoomFactor = 1.0 / this.config.zoomPerSecond;
    this._zooming = true;
    scheduleZoom( this );
}

function endZooming() {
    this._zooming = false;
}

function scheduleZoom( viewer ) {
    window.setTimeout( $.delegate( viewer, doZoom ), 10 );
}

function doZoom() {
    var currentTime,
        deltaTime,
        adjustFactor;

    if ( this._zooming && this.viewport) {
        currentTime     = +new Date();
        deltaTime       = currentTime - this._lastZoomTime;
        adjustedFactor  = Math.pow( this._zoomFactor, deltaTime / 1000 );

        this.viewport.zoomBy( adjustedFactor );
        this.viewport.applyConstraints();
        this._lastZoomTime = currentTime;
        scheduleZoom( this );
    }
};

function doSingleZoomIn() {
    if ( this.viewport ) {
        this._zooming = false;
        this.viewport.zoomBy( 
            this.config.zoomPerClick / 1.0 
        );
        this.viewport.applyConstraints();
    }
};

function doSingleZoomOut() {
    if ( this.viewport ) {
        this._zooming = false;
        this.viewport.zoomBy(
            1.0 / this.config.zoomPerClick
        );
        this.viewport.applyConstraints();
    }
};

function lightUp() {
    this.buttons.emulateEnter();
    this.buttons.emulateExit();
};

function onHome() {
    if ( this.viewport ) {
        this.viewport.goHome();
    }
};

function onFullPage() {
    this.setFullPage( !this.isFullPage() );
    // correct for no mouseout event on change
    this.buttons.emulateExit();  
    if ( this.viewport ) {
        this.viewport.applyConstraints();
    }
};

}( OpenSeadragon ));
