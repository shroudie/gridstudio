(function(){
	String.prototype.format = function() {
		var args = arguments;
		return this.replace(/{(\d+)}/g, function(_, number) { 
		return typeof args[number] != 'undefined'
			? args[number]
			: "0"
		;
		});
	};

	const data_from_csvtext = (text, sep=',') => {
		var data = [];
		text.split('\n').map((row) => {
			if (row.length > 0) {
				let cur = [];
				row.split(sep).map((col) => {
					const num = Number(col);
					if (!isNaN(num)) cur.push(num);
					else cur.push(col);
				})
				data.push(cur);
			}
		})
		return data;
	}

	const data_to_csvtext = (data) => {
		return data.map((row) => row.join(',')).join('\n')
	}

	
	// macOS swipe back prevention
	history.pushState(null, null, '');
	window.addEventListener('popstate', function(event) {
		history.pushState(null, null, '');
	});

	function http_req(method, url, cb, data=null) {
		var xhr = new XMLHttpRequest();
		xhr.open(method, url);
		xhr.onload = function () {
		  if (xhr.status == 200) {
			  cb(xhr.response);
		  } else {
			  console.log(xhr.status, xhr.response);
		  }
		};
		xhr.onerror = function () {
		  console.log(xhr.status, xhr.response);
		};
		xhr.send(data);
	}

	function download(data, filename, type) {
		var file = new Blob([data], {type: type});
		if (window.navigator.msSaveOrOpenBlob) // IE10+
			window.navigator.msSaveOrOpenBlob(file, filename);
		else { // Others
			var a = document.createElement("a"),
					url = URL.createObjectURL(file);
			a.href = url;
			a.download = filename;
			document.body.appendChild(a);
			a.click();
			setTimeout(function() {
				document.body.removeChild(a);
				window.URL.revokeObjectURL(url);  
			}, 0); 
		}
	}

	function getMaxOfArray(numArray) {
		return Math.max.apply(null, numArray);
	}

	function getMinOfArray(numArray) {
		return Math.min.apply(null, numArray);
	}

	function CutCopyPasteSelection(cells, sheetIndex, type){
		this.cells = cells;
		this.sheetIndex = sheetIndex;
		this.type = type;
	}
	
	function dataURLtoBytes(url){
		return (fetch(url)
			.then(function(res){return res.arrayBuffer();})
			.then(function(buf){return buf; })
		);
	}
	
	String.prototype.capitalize = function() {
		return this.replace(/(?:^|\s)\S/g, function(a) { return a.toUpperCase(); });
	};

	var App = function(){

		var _this = this;

		this.wsManager = new WSManager(this);
		this.fileManager = new FileManager(this);
		this.testManager = new TestManager(this);
		this.editor = new Editor(this);
		this.codeGen = new CodeGen(this);
		this.termManager = new TermManager(this);
		
 		this.dom = document.querySelector('body');
		this.canvas = document.createElement('canvas');
		this.canvasWidth, this.canvasHeight;

		this.ctx = this.canvas.getContext('2d', {alpha: false});
		
		this.sheetDom = document.querySelector('div-sheet');
		this.sheetSizer = this.sheetDom.querySelector('.sheet-sizer');
		this.formula_input = $(this.dom.querySelector('.formula-bar input'));
		this.mouse_down_canvas = false;
		this.mouseRightClickLocation = [0,0];
		this.console = $('.console');

		this.numRows = 10000;
		this.numColumns = 26;

		this.sheetOffsetY = 0;
		this.sheetOffsetX = 0;
		this.scrollOffsetX = 0;
		this.scrollOffsetY = 0;
		this.textPadding = 3;
		
		this.plots = {};
		this.callbacks = {};

		this.lastMousePosition = [0,0];

		this.minColRowSize = 20;

		this.sidebarSize = [30,25];
		this.minSidebarSize = [30,25];

		this.drawRowStart = 0;
		this.drawColumnStart = 0;
		this.drawRowEnd = 0;
		this.drawColumnEnd = 0;
		
		this.pixelRatio = window.devicePixelRatio;

		this.selectedCells = [[0,0],[0,0]];
		this.selectedCellsPerSheet = [];

		this.cutCopyPasteSelection;

		this.activeSheet = 0;
		this.sheetSizes = [];
		this.sheetNames = [];
		this.data = [];
		this.dataFormulas = [];

		this.rowHeightsCache = [];
		this.columnWidthsCache = [];

		this.init_input_field_backup_value = undefined;
		
		this.fontStyle = "12px Arial";
		this.fontHeight = determineFontHeight(this.fontStyle);


		//customized data

		this.dataset; //original data
		this.filters = {};

		this.graph = {};
		this.d3_next_state = {
			src: null,
			arr: null,
			dst: null,
			foc: null,
		};

		const ACTION_CONNECT = 'CONN', ACTION_DRAG = 'DRAG';
		this.action;

		const D3_TEXT_OFFSET = 30;

		const _zoom_callback = d3.zoom().scaleExtent([0.5, 20])
		.on('zoom', () => {
			document.body.style.cursor = 'pointer';
			
			gsvg.attr('transform', d3.event.transform);
		})
		.on('end', () => {
            document.body.style.cursor = 'default';
		});

		const _drag_callback = d3.drag()
		.on('start', (e) => {
			d3.event.sourceEvent.stopPropagation();

			const target = d3.event.sourceEvent.target;
			if (d3.event.sourceEvent.shiftKey) {
				_this.action = ACTION_CONNECT;
				_this.d3_next_state.src = target;
				_this.d3_next_state.arr = _add_arrow(target.getAttribute('cx'), target.getAttribute('cy'));
			} else {
				_this.action = ACTION_DRAG;
				_this.d3_next_state.src = target;
			}
		})
		.on('drag', (e) => {
			if (_this.action === ACTION_CONNECT) {
				const dst = _this.d3_next_state.dst;
				var x, y;
				if (dst !== null) {
					x = dst.getAttribute('cx');
					y = dst.getAttribute('cy');
				} else {
					x = d3.event.x;
					y = d3.event.y;
				}
				_this.d3_next_state.arr.attr('x2', x).attr('y2', y);
			} else if (_this.action === ACTION_DRAG) {
				const x = d3.event.x, y = d3.event.y;
				_this.d3_next_state.src.setAttribute('cx', x);
				_this.d3_next_state.src.setAttribute('cy', y);

				const n = _this.graph[e.id];
				n.g.l.attr('x', x + D3_TEXT_OFFSET).attr('y', y);
				n.g.a[0].forEach((arrow) => {
					d3.select(arrow).attr('x1', x).attr('y1', y);
				})
				n.g.a[1].forEach((arrow) => {
					d3.select(arrow).attr('x2', x).attr('y2', y);
				})
			}
		})
		.on('end', (e) => {
			if (_this.action === ACTION_CONNECT) {
				if (_this.d3_next_state.dst !== null) {
					const dst = d3.select(_this.d3_next_state.dst).data()[0].id;
					const src = d3.select(_this.d3_next_state.src).data()[0].id;
					if (_simple_connect_check(src, dst)) {
						_this.graph[dst].d.args[1] = _this.graph[src].d;

						_this.graph[src].g.a[0].add(_this.d3_next_state.arr.node());
						_this.graph[dst].g.a[1].add(_this.d3_next_state.arr.node());

						_this.graph[src].n.add(JSON.stringify(dst));
					} else {
						alert('Invalid Operation.');
						_this.d3_next_state.arr.remove();
					}
				} else {
					_this.d3_next_state.arr.remove();
				}
			}
			_this.action = null;
			_this.d3_next_state.src = null;
		})

		const svg = d3.select('#svg-panel-div').append('svg').attr('width', '100%').attr('height', '100%').call(_zoom_callback);
		const gsvg = svg.append('g').attr('transform', 'translate(0, 0) scale(1)');
		_add_d3_refs();

		const socket = io('http://localhost:5000/task');
		socket.on('connect_error', () => {
			// alert("Make sure server is running and try again.");
			socket.close();
		});

		socket.on('log', (data) => {
			console.log("#Log: ", data)
		});
	
		function add_intermediate_data(data) {
			const _id = parseInt(data.source);
			_find_node(_id).style('fill', '#D3D3D3');
			_this.graph[_id].cache = data.message;
		}

		function clear_intermediate_data(_id) {
			_find_node(_id).style('fill', 'white');
			_this.graph[_id].cache = null;
		}

		socket.on('intermediate', (data) => {
			add_intermediate_data(data);
		})

		socket.on('done', (data) => {
			// for (let i=0; i<data.length; ++i) {
				// const curr = data[i];
				if (data.status && data.source in _this.graph) {
					// console.log(data);
					_add_node_output(data);
				} else {
					console.log("#Execution Failed.");
				}
			// }
		});

		function _simple_connect_check(src, dst) {
			//connect src to dst
			return true;

			if (_this.graph[src].t == 'i' && _this.graph[dst].t == 'f') {
				return true;
			}
			return false;
		}

		const _focus_d3_element = (e) => {
			const elem = d3.select(e);
			if (_this.d3_next_state.foc !== null && elem.node() == _this.d3_next_state.foc.node()) {
				_unfocus_d3_element();
				return;
			}

			_unfocus_d3_element();
			elem.attr('stroke-width', 3);
			// console.log(elem.data());
			
			_this.d3_next_state.foc = elem;
		}

		const _unfocus_d3_element = () => {
			if (_this.d3_next_state.foc === null) return;
			const elem = _this.d3_next_state.foc;
			elem.attr('stroke-width', 1);
			_this.d3_next_state.foc = null;
		}

		const _clear_d3_group = () => {
			svg.selectAll("g").node().innerHTML = '';
			_this.graph = {};
		}

		const _remove_d3_element = () => {
			if (_this.d3_next_state.foc !== null) {
				const e = _this.d3_next_state.foc.node();
				if (e.tagName == 'line') {
					var n1 = null, n2 = [];
					for (var k in _this.graph) {
						if (_this.graph[k].g.a[0].delete(_this.d3_next_state.foc.node())) {
							n1 = _this.graph[k];
						}
						if (_this.graph[k].g.a[1].delete(_this.d3_next_state.foc.node())) {
							n2.push(_this.graph[k]);
						}
					}
					if (n1.t == 'i') { 
						// node is dataset
						n2.map((n) => {
							n.d.args[1] = null;
						})
					}
					_this.d3_next_state.foc.remove();
				} else if (e.tagName == 'circle') {
					const ref = _this.graph[_this.d3_next_state.foc.data()[0].id];
					ref.g.l.remove();
					const arrows = new Set([...ref.g.a[0], ...ref.g.a[1]]);
					arrows.forEach((l) => {
						for (const [_, node] of Object.entries(_this.graph)) {
							node.g.a[0].delete(l);
							node.g.a[1].delete(l);
						}
						d3.select(l).remove();
					})
					_this.d3_next_state.foc.remove();
					delete _this.graph[_this.d3_next_state.foc.data()[0].id];
				}
			}
			_this.d3_next_state.foc = null;
		}
		
		const default_node_callback = {
			'mouseover':  () => { document.body.style.cursor = 'pointer' },
			'mouseout': () => { document.body.style.cursor = 'default' },
			'click' : () => { console.log('clicked') },
			'click.focus': () => { _focus_d3_element(d3.event.target) }
		};

		const _add_node_mousecallback = (n, cb= {}) => {
			for (const [k, v] of Object.entries(default_node_callback)) {
				if (!(k in cb)) 
					cb[k] = v;
			}
			for (const [k, v] of Object.entries(cb)) {
				n.on(k, v);
			}
			// n
			// .on('mouseover', () => {
			// 	document.body.style.cursor = 'pointer';
			// }) 
			// .on('mouseout', () => {
			// 	document.body.style.cursor = 'default';
			// })
		}

		function _reset_datasheet() {
			var index = -1;
			const data = _this.data[_this.activeSheet];
			for (let i=0; i<data.length; ++i) {
				if (data[i][0] === "") {
					index = i; break;
				}
			}
			if (index > -1) {
				for (var i=index; i>0; --i) {
					_this.wsManager.send({arguments: ["DELETEROW", "A" + i]});
				}
			}
		}

		function _add_d3_refs() {
			svg.append('svg:defs')
				.append('svg:marker')
				.attr('id', 'triangle')
				.attr('viewBox', '0 0 10 10')
				.attr('refX', 1)
				.attr('refY', 5)
				.attr('markerWidth', 6)
				.attr('markerHeight', 6)
				.attr('orient', 'auto')
				.append('path')
				.attr('d', 'M 0 0 L 10 5 L 0 10 z')
				.attr('stroke', 'black')
				.attr('fill', 'white');
		}

		function _add_arrow(x1, y1, x2=x1, y2=y1) {
			const l = gsvg
				.append('line')
				.attr('x1', x1)
				.attr('y1', y1)
				.attr('x2', x2)
				.attr('y2', y2)
				.attr('stroke', 'black')
				.attr('stroke-width', 1)
				.attr('marker-end', 'url(#triangle)');
			l.on('click', () => _focus_d3_element(l.node()));
			return l;
		}

		function _add_node_dataset(dataset) {
			const _id = Object.keys(_this.graph).length;
			const cx = 50, cy = 50, r = 20;
			const node = gsvg.append('circle').attr('class', 'nodei').attr('cx', cx).attr('cy', cy).attr('r', r).attr('stroke', 'black').style('fill', 'white').data([{id: _id}]).call(_drag_callback);
			// _add_node_callback(node);

			const text = gsvg.append('text').attr('x', cx + D3_TEXT_OFFSET).attr('y', cy).attr('fill', 'black').attr('dy', '0.5em').text(dataset);

			_this.graph[_id] = {
				t: 'i', //node type
				d: [],//_reduced_sheet(_this.data[_this.activeSheet]), //node data
				g: {
					l: text,	//text label
					a: [new Set(), new Set()], //arrows
				},
				n: new Set() //next target
			}
			const ref = _this.graph[_id];
			http_req('GET', 'http://localhost:5000/example/' + dataset, (resp) => {
				_this.wsManager.send({arguments: ["CSV", resp]});
				ref.d = data_from_csvtext(resp);
			});


			_add_node_mousecallback(node, {
				'click': () => {
					_this.data[_this.activeSheet] = [];
					const text = data_to_csvtext(ref.d);
					_reset_datasheet();
					_this.wsManager.send({arguments: ["CSV", text]});
				},
			});

			return node;
		}
	
		const kargs = {
			apriori: { sup: 0.3, fun: 'apriori' },
			capriori: { cols: [], fun: 'capriori' },
			kmeans: { cluster: [2, 5], fun: 'kmeans' }, 
			validate: { method: 'normcut', fun: 'validate' },
			filter: { 
				arg: [/*{
					k: 'close_city_name',
					v: 'Berkeley',
					t: 'string'
				}*/{
					k: 'median_house_value',
					v: [100000, 200000],
					t: 'range'
				}], fun: 'filter'
			},
		};

		const _change_node_args = (id, key, val) => {
			_this.graph[id].d.karg[key] = val;
		}

		const node_func_tplt = {
			validate: `
				<div>
					<h3>Validate</h3>
				</div>
				<div>
					<select>
						<option value="normcut" selected>Normalized Cut</option>
					</select>
				</div>
			`,
			kmeans: `
				<div>
					<h3>Kmeans</h3>
				</div>
				<div>
					<label>Range #ofClusters</label></br>
					<input style="width:100px" name="sup" type="number" value=2 step=1 min="2" /></br>
					<input style="width:100px" name="sup" type="number" value=5 step=1 min="2" /></br>
					<button>Visualize</button>
				</div>
			`,
			apriori: `
				<div>
					<h3>Dataset</h3>
					<span>{0}</span>
				</div>
				<div>
					<h3>Arguments</h3>
					<label>Min Support</label> 
					<input style="width:100px" name="sup" type="number" value={1} step=0.1 min="0" max="1" />
				</div>
				<div>
					<button id="vis">Visualize</button>
				</div>
			`,
			capriori: `
				<div>
					<h3>Cluster Apriori</h3>
				</div>
				<div>
					<fieldset>
					<legend>Columns to be Processed</legend>
					<ul class="checkbox">
					</ul>
					</fieldset>
				</div>
			`,
			filter:`
				<div class="data-filter">
					<p>Filter Panel<p>
					<div>
						<select>
						</select>
						</br>
						<label>Min</label> 
						<input style="width:100px" name="min" type="number" value={0} step=1 />
						<label>Max</label> 
						<input style="width:100px" name="max" type="number" value={1} step=1 />
					</div>
					<div>
						<button id="imp">Import</button>
						<button id="vis">Visualize</button>
					</div>
				</div>
			`
			
		}

		function _get_node_columns(_id) {
			var columns = [];
			let sid = _id.toString();
			let max_iter = Object.keys(_this.graph).length;
			while (max_iter > 0) {
				max_iter -= 1;
				for (const [nid, node] of Object.entries(_this.graph)) {
					if (node.n.has(sid)) {
						if (node.t == 'i' && node.d !== undefined) {
							for (var i=0; i<node.d[0].length; ++i) {
								columns.push(node.d[0][i]);
							}
							return columns;
						} else {
							sid = nid.toString();
						}
						break;
					}
				}
			}
			return columns;
		}

		function _add_node_function(func) {
			const _id = Object.keys(_this.graph).length;
			const cx = 50, cy = 150, r =20;
			const node = gsvg.append('circle').attr('class', 'nodef').attr('cx', cx).attr('cy', cy).attr('r', r).attr('stroke', 'black').style('fill', 'white').data([{id: _id}]).call(_drag_callback);
			// _add_node_callback(node);
			
			const text = gsvg.append('text').attr('x', cx + D3_TEXT_OFFSET).attr('y', cy).attr('fill', 'black').attr('dy', '0.5em').text(func);

			_this.graph[_id] = {
				t: 'f', //node type
				d: {
					args: [func, null],
					karg: JSON.parse(JSON.stringify(kargs[func])) //copy dictionary is necesasry
				}, //[func, null], //node data
				g: {
					l: text,	//text label
					a: [new Set(), new Set()], //[outgoing, incoming]
				},
				n: new Set(),
				cache: null,
			}
			const ref = _this.graph[_id];
			_add_node_mousecallback(node, {
				mouseover: () => { 
					document.body.style.cursor = 'pointer'; 
					_this.d3_next_state.dst = d3.event.target; 
				},
				mouseout: () => { 
					document.body.style.cursor = 'default';
					_this.d3_next_state.dst = null; 
				},
				click: () => { 
					if (func === 'apriori') {
						$('#code-editor-div').html(node_func_tplt[func].format("", ref.d.karg.sup)); 
						$('#code-editor-div :input').on('change', (e) => {
							console.log(e);
							_this.graph[_id].d.karg[e.target.name] = parseFloat(e.target.value);
						});
						$('#code-editor-div button').off('click');
						$('#code-editor-div button#vis').on('click', () => {
							if (ref.cache !== null) {
								let group_data = [];
								for (let i=0; i<ref.cache.data.length; ++i) {
									group_data.push({data: ref.cache.data[i]});
								}
								var map_data = {
									cols: _this.data[0][0],
									grps: group_data
								};
								console.log("map_data")
								console.log(map_data);
								data = processData(map_data);
								console.log(data);
								var d = document.createAttribute('data-map');
								d.value = data;
								var button = document.getElementById('vis');
								button.setAttributeNode(d);
								$('#MyPopup').modal('show').find('.modal-body').load('map/index.html');
							}
						})
					} else if (func === 'filter') {
						var filter_args = _this.graph[_id].d.karg.arg[0];

						$('#code-editor-div').html(node_func_tplt[func].format(filter_args.v[0], filter_args.v[1])); 
						const cols = _get_node_columns(_id);
						cols.forEach(e => {
							$('#code-editor-div select').append(new Option(e, e));
						})
						$('#code-editor-div select').val(filter_args.k);

						$('#code-editor-div select').on('change', function() {
							filter_args.k = this.value;
						});
						$('#code-editor-div input').on('change', function() {
							if (this.name == 'min') {
								filter_args.v[0] = this.value;
							} else if (this.name == 'max') {
								filter_args.v[1] = this.value;
							}
						});
						
						$('#code-editor-div button').off('click');
						$('#code-editor-div button#imp').on('click', () => {
							if (ref.cache !== null) {
								if (ref.cache.type === 'sheet') {
									_reset_datasheet();
									_this.wsManager.send({arguments: ["CSV", data_to_csvtext(ref.cache.data)]});
								}
							}
						});
						$('#code-editor-div button#vis').on('click', () => {
							var map_data = {
								cols: ref.cache.data[0],
								grps: [{
									data: ref.cache.data.slice(1),
								}]
							};
							// console.log(map_data);
							data = processData(map_data)
							// console.log(data);
							var d = document.createAttribute('data-map');
							d.value = data;
							var button = document.getElementById('vis');
							button.setAttributeNode(d);
							$('#MyPopup').modal('show').find('.modal-body').load('map/index.html');
						})
					} else if (func === 'kmeans') {
						$('#code-editor-div').html(node_func_tplt[func]); 
						$('#code-editor-div button').on('click', () => {
							if (ref.cache) {
								console.log(ref.cache);
							}
						})
					} else if (func === 'validate') {
						$('#code-editor-div').html(node_func_tplt[func]); 
					} else if (func === 'capriori') {
						$('#code-editor-div').html(node_func_tplt[func]); 
						const cols = _get_node_columns(_id);
						cols.forEach(e => {
							$('#code-editor-div ul').append('\
								<li>\
								<input type="checkbox" value="{0}" {1}/>\
								<label>{0}</label>\
								</li>\
							'.format(e, ref.d.karg.cols.indexOf(e)>-1?"checked":""));
						});
						$('#code-editor-div input').on('change', function() {
							const e = this.value;
							if (this.checked) {
								if (ref.d.karg.cols.indexOf(e) < 0)
									ref.d.karg.cols.push(e);
							} else {
								var index = ref.d.karg.cols.indexOf(e);
								if (index > -1) {
									ref.d.karg.cols.splice(index, 1);
								}
							}
						});
					}
				},
				contextmenu: () => {
					d3.event.preventDefault();
					console.log("#RIGHT CLICKED");
				}
			});
			return node;
		}

		function processData(d) {
			var results = [];
			var key = d.cols;
			var groups = d.grps;
			for (var i = 0; i < groups.length; i++){
				var currGroup = []; 
				var group = groups[i].data;
				for (var j = 0; j < group.length; j++){
					var point = group[j];
					var item = {};
					for (var k = 0; k < point.length; k++){
						var val = point[k];
						item[key[k]] = val;
					}
					currGroup.push(item)
				}
				results.push(currGroup);
			}
			return results;
		}

		function _find_node(_id) {
			return gsvg.selectAll('circle').filter((d) => { return d.id ==_id });
		}

		function _move_node(node, x, y) {
			node.attr('cx', x).attr('cy', y);
			const n = _this.graph[node.data()[0].id];
			n.g.l.attr('x', x + D3_TEXT_OFFSET).attr('y', y);
			n.g.a[0].forEach((arrow) => {
				d3.select(arrow).attr('x1', x).attr('y1', y);
			})
			n.g.a[1].forEach((arrow) => {
				d3.select(arrow).attr('x2', x).attr('y2', y);
			})
		}

		function _connect_node(n1, n2) {
			const arr = _add_arrow(n1.attr('cx'), n1.attr('cy'), n2.attr('cx'), n2.attr('cy'));
			_this.graph[n1.data()[0].id].g.a[0].add(arr.node());
			_this.graph[n2.data()[0].id].g.a[1].add(arr.node());
			_this.graph[n1.data()[0].id].n.add(JSON.stringify(n2.data()[0].id));
		}
		
		function _add_node_output(output) {
			const _id = Object.keys(_this.graph).length;


			const src = gsvg.selectAll('circle').filter((d) => { return d.id==output.source });

			const cx = src.attr('cx'), cy = parseInt(src.attr('cy')) + 100, r =20;
			const node = gsvg.append('circle').attr('class', 'nodeo').attr('cx', cx).attr('cy', cy).attr('r', r).attr('stroke', 'black').style('fill', 'white').data([{id: _id}]).call(_drag_callback);
			const text = gsvg.append('text').attr('x', parseFloat(cx) + D3_TEXT_OFFSET).attr('y', cy).attr('fill', 'black').attr('dy', '0.5em').text('OUTPUT' + src.data()[0].id);

			const arr = _add_arrow(src.attr('cx'), src.attr('cy'), node.attr('cx'), node.attr('cy'));

			// node.on('click', () => {
			// 	_create_view(output.message);
			// });
			_add_node_mousecallback(node, {'click': () => { _create_view(output.message, title=output.title) }});

			_this.graph[_id] = {
				t: 'o', //node type
				d: output, //node data
				g: {
					l: text,	//text label
					a: [new Set(), new Set([arr.node()])], //arrows
				}
			}
			_this.graph[output.source].g.a[0].add(arr.node());
		}

		function _create_view(view, title="") {
			let content = '<tr><th>Key</th><th>Value</th></tr>';
			if (view.type == 'table') {
				for (const [item, freq] of Object.entries(view.data)) {
					content += 
						'<tr>' + 
						'<td>' + item + '</td>' +
						'<td>' + freq + '</td>' +
						'</tr>';
				}
			}
			$('#code-editor-div').html('<div><h3>' + title + '</h3></div><div overflow:auto;><table>' + content + '</table></div>');
		}
	
	

		this.confirm_filter = function() {
			const dataset = _this.data[_this.activeSheet];
			var include = new Set();
			for (let i=0; i<dataset.length; ++i) {
				if (dataset[i][0] != '""') 
					include.add(i);
				else
					break;
			}

			for (let i=1; i<dataset.length; ++i) {
				for (let k in _this.filters) {
					if (!_this.filters[k].f(dataset[i][k])) {
						include.delete(i);
					}
				}
			}
			var next = [];
			include.forEach((i) => {
				next.push(dataset[i]);
			});

			const cols = dataset[0];
			for (let i=next.length; i<dataset.length; ++i) {
				var row = [];
				for (let j=0; j<cols.length; ++j) {
					row.push("");
				}
				next.push(row);
			}
			let csv = next.map(e => e.join(',')).join('\n');
			_this.wsManager.send({arguments: ["CSV", csv]});
		}

		const filter_number_tmplt = `
			<div class="data-filter">
				<form>
					<h2>{0}</h1>
					<label>Min</label>
					<input type="number" value="{1}"><br>
					<label>Max</label>
					<input type="number" value="{2}"><br>
					<input type="submit" value="Confirm">
				</form>
			</div>
		`;
		const filter_string_tmplt = `
			<div class="data-filter">
				<form>
					<h2>{0}</h1>
					<label>Value</label>
					<input type="text" value="{1}"><br>
					<input type="submit" value="Confirm">
				</form>
			</div>
		`;

		

		this.get = function(position, sheet){

			// undefined is reserved for out of bounds
			if(position[0] < 0 || position[1] >= this.numColumns){
				return undefined;
			}
			if(position[1] < 0 || position[0] >= this.numRows){
				return undefined;
			}

			if(this.data[sheet] === undefined){
				return "";
			}

			// do not return undefined for empty cells but an empty string (consistent with default cell values in backend)
			if(this.data[sheet][position[0]] === undefined){
				return ""; 
			}else{
				var value = this.data[sheet][position[0]][position[1]];
				if(value === undefined){
					value = "";
				}
				return value;
			}
		}
		this.get_range = function(cell1, cell2, sheetIndex) {
			var data = [];

			for(var x = cell1[0]; x <= cell2[0]; x++){
				for(var y = cell1[1]; y <= cell2[1]; y++){
					data.push(this.get([x, y], sheetIndex));
				}
			}
			return data;
		}
		this.get_formula = function(position, sheet){
			if(this.dataFormulas[sheet] == undefined){
				return undefined;
			}
			else if(this.dataFormulas[sheet][position[0]] === undefined){
				return undefined;
			}else{
				return this.dataFormulas[sheet][position[0]][position[1]];
			}
		}
		
		this.update_plots = function(){
			for(var key in this.plots){
				if(this.plots.hasOwnProperty(key)){
					this.update_plot(this.plots[key]);
				}
			}
		}

		this.reloadPlotData = function(plot){

			var x_range = plot.data[0];
			var y_range = plot.data[1];

			// refresh data only on initial plot
			if(x_range.length > 0){
				var rangeString = this.cellArrayToStringRange([x_range[0],x_range[1]]);
				this.refreshDataRange(rangeString, plot.sheetIndex);
			}

			if(y_range.length > 0){
				var rangeString = this.cellArrayToStringRange([y_range[0],y_range[1]]);
				this.refreshDataRange(rangeString, plot.sheetIndex);
			}

		}

		this.reloadPlotsData = function(){
			for(var key in this.plots){
				if(this.plots.hasOwnProperty(key)){
					this.reloadPlotData(this.plots[key]);
				}
			}
		}

		this.indexToLetters = function(index){
			var base = 26;
			var leftOver = index;
			var columns = [];
			var buff = "";

			while(leftOver > 0) {
                var remainder = leftOver % base;
                if (remainder == 0){
                    remainder = base;
                }
				columns.unshift(remainder);
				leftOver = (leftOver - remainder) / base;
			}

			for(var x = 0; x < columns.length; x++){
				buff += String.fromCharCode(64 + columns[x]);
			}
			return buff;
		}
		
		this.lettersToIndex = function(letters){
			var index = 0;
			var columns = letters.length - 1;
			var base = 26;

			for(var x = 0; x < letters.length; x++){
				var number = letters[x].charCodeAt(0)-64;
				index += number * Math.pow(base, columns);
				columns--;
			}

			return index;
		}

		this.cellZeroIndexToString = function(rowIndex, columnIndex){
			return this.indexToLetters(columnIndex+1) + (rowIndex+1);
		}

		this.referenceToZeroIndexedArray = function(reference){

			var splitIndex = 0;
			for(var x = 0; x < reference.length; x++){
				if(reference[x] < 'A'){
					splitIndex = x;
					break
				}
			}
			var column = this.lettersToIndex(reference.substring(0, splitIndex)) - 1;
			var row = parseInt(reference.substring(splitIndex)) - 1;

			return [row, column];
		}


		this.set_formula = function(position, value, update, sheet) {
			if(value == "="){
				value = "";
			}
			// unescape "
			value = value.replace(/\\\"/g, "\"")

			if(!this.dataFormulas[sheet][position[0]]){
				this.dataFormulas[sheet][position[0]] = [];
			}

			// check if value is numeric
			var isNumber = /^-?[0-9]\d*(\.\d+)?$/.test(value);
			if(isNumber){
				value = "=" + value;
			}

			this.dataFormulas[sheet][position[0]][position[1]] = value.toString();
			
			if(update !== false){
				this.wsManager.send({arguments: ["SET", this.indexToLetters(position[1]+1) + (position[0]+1), value.toString(), ""+sheet]});
			}
		}

		this.set = function(position, value, sheet){
			if(!this.data[sheet][position[0]]){
				this.data[sheet][position[0]] = [];
			}
			this.data[sheet][position[0]][position[1]] = value.toString();

			// let ref = this.graph_current.d;
			// if (!ref[position[0]]) {
			// 	ref[position[0]] = [];
			// }
			// if (value == "") return;
			// if (position[0] == 0) {
			// 	ref[position[0]][position[1]] = value;
			// } else {
			// 	const num = Number(value);
			// 	if (isNaN(num)) ref[position[0]][position[1]] = value;
			// 	else ref[position[0]][position[1]] = num;
			// }
		}

		this.initTabs = function(){

			 // Tabbed area
			$('.dev-tabs .tab').click(function(){

				var selector = $(this).attr('data-tab');
				_this.showTab(selector);
				
			});
			
		}

		this.addStaticPlot = function(img){

			this.staticPlotCount++;
			$('.view.plots .plot-holder').append(img);

			this.setStaticPlotIndex(this.staticPlotCount-1);

		}

		this.updateStaticPlotText = function(){
			$('.view.plots .plot-counter').html((this.currentStaticPlot+1) + "/" + this.staticPlotCount);
		}

		this.setStaticPlotIndex = function(index){

			this.currentStaticPlot = index;

			// mark left arrow half opacity if 
			$('.view.plots .plot-navigator').children().removeClass('disabled');

			if(index == 0){
				$('.view.plots .plot-left').addClass('disabled');
			}
			if(index == this.staticPlotCount-1){
				$('.view.plots .plot-right').addClass('disabled');
			}

			$('.view.plots .plot-holder img').eq(index).addClass('active').siblings().removeClass('active');

			this.updateStaticPlotText();
		}

		this.initStaticPlots = function(){
			this.staticPlotCount = 0;
			this.currentStaticPlot = 0;

			$('.view.plots .plot-left, .view.plots .plot-right').click(function(){
				var direction = 1;
				if($(this).hasClass('plot-left')){
					direction = -1;
				}

				var newIndex = _this.currentStaticPlot+direction;
				if(newIndex >= 0 && newIndex < _this.staticPlotCount){
					_this.setStaticPlotIndex(newIndex);					
				}

			});
		}

		this.showTab = function(selector){

			$('.dev-tabs .tab[data-tab="'+selector+'"]').addClass('current').siblings().removeClass('current');

			// hide both
			$('.dev-tabs .view').hide();
		
			// show selected
			$('.dev-tabs .' + selector).show();

			if(selector == "filemanager"){
				_this.fileManager.refresh();
			}

		}



		this.ctx.a_moveTo = function(x,y){
			_this.ctx.moveTo(x+0.5,y+0.5);
		}
		this.ctx.a_lineTo = function(x,y){
			_this.ctx.lineTo(x+0.5,y+0.5);
		}

		this.init_input = function(){

			// add input element to dom
			var input = document.createElement('input');
			$(input).addClass('input-field');
			this.input_field = $(input);
			this.input_field.hide();
			this.input_field.css({font: this.fontStyle});

			this.sheetDom.insertBefore(input, this.sheetDom.children[0]);

		}

		this.efficientTotalWidth = function(){
			var width = this.numColumns * this.cellWidth;

			// adapt based on modified widths
			for(var key in this.columnWidthsCache){
				width += this.columnWidthsCache[key];
				width -= this.cellWidth;
			}

			width += this.sidebarSize[0];

			return width;
		}

		this.efficientTotalHeight = function(){
			var height = this.numRows * this.cellHeight;

			// adapt based on modified widths
			for(var key in this.rowHeightsCache){
				height += this.rowHeightsCache[key];
				height -= this.cellHeight;
			}

			height += this.sidebarSize[1];

			return height;
		}

		this.sizeSizer = function(){
			
			this.canvas.width = this.sheetDom.clientWidth * this.pixelRatio;
			this.canvasWidth = this.canvas.width;

			this.canvas.height = this.sheetDom.clientHeight * this.pixelRatio;
			this.canvasHeight = this.canvas.height;

			this.canvas.style.width = this.sheetDom.clientWidth + "px";
			this.ctx.scale(this.pixelRatio,this.pixelRatio);

			// determine width based on columnWidths
			var sizerWidth = this.efficientTotalWidth();

			if(sizerWidth > 40000){
				sizerWidth = 40000;
			}
			if(sizerWidth < this.sheetDom.clientWidth){
				sizerWidth = this.sheetDom.clientWidth
			}

			// determine height based on rowHeights
			var sizerHeight = this.efficientTotalHeight();

			if(sizerHeight > 40000){
				sizerHeight = 40000;
			}
			if(sizerHeight < this.sheetDom.clientHeight){
				sizerHeight = this.sheetDom.clientHeight
			}

			this.sheetSizer.style.height = sizerHeight + "px";
			this.sheetSizer.style.width = sizerWidth + "px";

			this.updateOffset();
		}

		this.initImagePlotTab = function(){

			$(document).on('click','.full-plot', function(){
				$(this).remove();
			});

			$(document).on('keydown', function(e){
				if(e.keyCode == 27){
					if($('.full-plot').length > 0){
						$('.full-plot').remove();
					}
				}
			});

			$(".dev-tabs .plots").on('click', 'img', function(){
				// create full screen image
				var image_data = $(this).attr('src');
				$('body').append("<div class='full-plot'><img title='Click to close' src='"+image_data+"' /></div>");
			});
		}

		this.getWorkspaceDetails = function(){
			var slug = window.location.href.split("/")[4];
			this.slug = slug;;

			$.post("/get-workspace-details",{workspaceSlug: slug}, function(data){
				$('.workspaceName input[name="workspaceName"]').val(data.name);
				$('.workspaceName input[name="id"]').val(data.id);
			});

			$(document).on("change", ".workspaceName input", function(){

				var val = $(this).val();
				var id = $(this).parent().find("input[name='id']").val();

				$.post("/workspace-change-name", {workspaceId: id, workspaceNewName: val }, function(data, error){
					if(error != "success"){
						console.error(error);
					}
				})
			});
		}

		this.sortRange = function(direction, range){

			var rangeString = this.cellZeroIndexToString(range[0][0], range[0][1]) + ":" + this.cellZeroIndexToString(range[1][0], range[1][1]);

			var currentCellLocation = this.positionToCellLocation(this.lastMousePosition[0], this.lastMousePosition[1]);
			var column = this.indexToLetters(currentCellLocation[1] + 1);

			_this.wsManager.send({arguments: ["SORT", direction, rangeString, column]});
		}

		this.requestSheetSize = function(){

			var rows = parseInt(prompt("Rows count:", this.numRows));
			var columns = parseInt(prompt("Column count:", this.numColumns));

			if(!isNaN(rows) && !isNaN(columns) && rows >= 1 && columns >= 1){

				var confirmAmount = true;

				if(rows * columns > 1000000){
					confirmAmount = confirm("You're creating over a million cells, Grid isn't fully optimized yet. This amount could result in a degraded user experience, are you sure you want to continue?");
				}

				if(confirmAmount){
					this.wsManager.send({arguments:["SETSIZE",""+rows,""+columns, ""+this.activeSheet]})
				}

			}

		};

		this.deleteRowColumn = function(type){
			
			var clickedCellPosition = _this.positionToCellLocation(_this.mouseRightClickLocation[0],_this.mouseRightClickLocation[1]);
			_this.wsManager.send({arguments: [type, this.cellZeroIndexToString(clickedCellPosition[0], clickedCellPosition[1])]});
			console.log({arguments: [type, this.cellZeroIndexToString(clickedCellPosition[0], clickedCellPosition[1])]});
		}

		this.insertRowColumn = function(type, direction){
			
			var clickedCellPosition = _this.positionToCellLocation(_this.mouseRightClickLocation[0],_this.mouseRightClickLocation[1]);

			_this.wsManager.send({arguments:["INSERTROWCOL", type, direction, this.cellZeroIndexToString(clickedCellPosition[0], clickedCellPosition[1])]});
		}

		this.registerContextMenu = function(){
			$(_this.sheetDom).bind("contextmenu", function (event) {
    
				// Avoid the real one
				event.preventDefault();

				_this.mouseRightClickLocation = [event.offsetX - _this.sheetDom.scrollLeft, event.offsetY - _this.sheetDom.scrollTop];

				// Show contextmenu
				$(".context-menu").toggleClass("shown").css({
					left: event.clientX + "px",
					top: event.clientY + "px"
				});

				$('.context-menu .hide').hide();

				// show contextual items
				
				if(_this.mouseRightClickLocation[0] <= _this.sidebarSize[0]){
					$('.context-menu .row-only').show();
				}
				if(_this.mouseRightClickLocation[1] <= _this.sidebarSize[1]){
					$('.context-menu .column-only').show();
				}

				// make sure contextMenu is always in view
				var contextMenuHeight = $('.context-menu').outerHeight();
				var contextMenuWidth = $('.context-menu').outerWidth();
				if(contextMenuHeight + event.clientY > $(window).height()){
					$(".context-menu").css({
						top: $(window).height() - contextMenuHeight + "px"
					});
				}

				if(contextMenuWidth + event.clientX > $(window).width()){
					$(".context-menu").css({
						left: $(window).width() - contextMenuWidth + "px"
					});
				}

			});

			$(".context-menu .context-menu-item").click(function(e){
				e.preventDefault();

				if($(this).hasClass('sort-asc')){
					_this.sortRange("ASC", _this.selectionToLowerUpper(_this.selectedCells));
				}else if($(this).hasClass('sort-desc')){
					_this.sortRange("DESC", _this.selectionToLowerUpper(_this.selectedCells));
				}else if($(this).hasClass('copy')){
					_this.copySelection();
				}else if($(this).hasClass('cut')){
					_this.cutSelection();
				}else if($(this).hasClass('paste')){
					_this.pasteSelection();
				} else if($(this).hasClass('paste-as-value')){
					_this.pasteSelectionAsValue();
				} else if($(this).hasClass('sheet-size')){
					_this.requestSheetSize();
				}else if($(this).hasClass('insert-column-left')){
					_this.insertRowColumn('COLUMN','LEFT');
				}else if($(this).hasClass('insert-column-right')){
					_this.insertRowColumn('COLUMN','RIGHT');
				}else if($(this).hasClass('insert-row-above')){
					_this.insertRowColumn('ROW','ABOVE');
				}else if($(this).hasClass('insert-row-below')){
					_this.insertRowColumn('ROW','BELOW');
				}else if($(this).hasClass('delete-column')){
					_this.deleteRowColumn('DELETECOLUMN');
				}else if($(this).hasClass('delete-row')){
					_this.deleteRowColumn('DELETEROW');
				}else if($(this).hasClass('codegen')){
					var method = $(this).attr('data-method');
					var selection = _this.cellArrayToStringRange(_this.getSelectedCellsInOrder()); 
					_this.codeGen.generate(method, selection, _this.activeSheet);
				}else if($(this).hasClass('filter')) {
					const cell = _this.positionToCellLocation(_this.mouseRightClickLocation[0],_this.mouseRightClickLocation[1])[1];
					const data = _this.data[_this.activeSheet];
					
					const sample = JSON.parse(_this.dataFormulas[_this.activeSheet][1][cell].substring(1));
					let val = _this.filters[cell] !== undefined ? _this.filters[cell].v : undefined;

					const filter_div = $('#code-editor-div');
					if (typeof(sample)  === "string") {
						if (val === undefined) val = sample;
						filter_div.html(filter_string_tmplt.format(data[0][cell], val));
						filter_div.find("form").on('submit', (e) => {
							e.preventDefault();
							const frm = e.target;
							_this.filters[cell] = {
								f: (v) => {
									return v == frm[0].value;
								},
								v: frm[0].value
							}
							_this.confirm_filter();
						});
					} else if (typeof(sample) === 'number') {
						if (val === undefined) val = [sample, sample];
						filter_div.html(filter_number_tmplt.format(data[0][cell], val[0], val[1]));
						filter_div.find("form").on('submit', (e) => {
							e.preventDefault();
							const frm = e.target;
							_this.filters[cell] = {
								f: (v) => {
									return v >= frm[0].value && v <= frm[1].value;
								},
								v: [frm[0].value, frm[1].value]
							}
							_this.confirm_filter();
						});
					}
				}

				$('.context-menu').removeClass("shown");

			});

			$('div-sheet').bind("mousedown",function(){
				$(".context-menu").removeClass('shown');
			})
			
		}

		this.cutSelection = function(){
			this.cutCopyPasteSelection = new CutCopyPasteSelection(this.getSelectedCellsInOrder(), this.activeSheet, 'cut');
		}

		this.copySelection = function(){
			this.cutCopyPasteSelection = new CutCopyPasteSelection(this.getSelectedCellsInOrder(), this.activeSheet, 'copy');
		}
		this.pasteSelection = function(){
			if(this.cutCopyPasteSelection){

				// send copy command
				var sourceRange = this.cellArrayToStringRange(this.cutCopyPasteSelection.cells);
				var destinationRange = this.cellArrayToStringRange(this.getSelectedCellsInOrder());

				if(this.cutCopyPasteSelection.type == 'cut'){
					this.wsManager.send({arguments: ["CUT", sourceRange, this.cutCopyPasteSelection.sheetIndex + "", destinationRange, this.activeSheet+""]})
					this.cutCopyPasteSelection = undefined;
				}else{
					this.wsManager.send({arguments: ["COPY", sourceRange, this.cutCopyPasteSelection.sheetIndex + "", destinationRange, this.activeSheet+""]})
				}
			}
		}

		this.pasteSelectionAsValue = function(){
			if(this.cutCopyPasteSelection){

				// send copy command
				var sourceRange = this.cellArrayToStringRange(this.cutCopyPasteSelection.cells);
				var destinationRange = this.cellArrayToStringRange(this.getSelectedCellsInOrder());

				if(this.cutCopyPasteSelection.type == 'copy'){
					this.wsManager.send({arguments: ["COPYASVALUE", sourceRange, this.cutCopyPasteSelection.sheetIndex + "", destinationRange, this.activeSheet+""]})
				} else if(this.cutCopyPasteSelection.type == 'cut'){
					this.wsManager.send({arguments: ["CUTASVALUE", sourceRange, this.cutCopyPasteSelection.sheetIndex + "", destinationRange, this.activeSheet+""]})
					this.cutCopyPasteSelection = undefined;
				}
			}
		}
		
		// this.getSheets() = function(){
		// 	this.wsManager.send({arguments: ["GETSHEETS"]}));
		// }

		this.setSheets = function(sheetsArray){

			this.data = [];
			this.dataFormulas = [];
			this.sheetSizes = [];
			this.sheetNames = [];
			this.selectedCellsPerSheet = [];

			$('.sheet-tabs-holder').html("");

			for(var x = 0; x < sheetsArray.length; x+= 3){
				var sheetName = sheetsArray[x];
				var rowCount = parseInt(sheetsArray[x+1]);
				var columnCount = parseInt(sheetsArray[x+2]);

				this.sheetSizes.push([rowCount, columnCount]);
				this.sheetNames.push(sheetName);

				$('.sheet-tabs-holder').append("<div class='sheet-tab'>"+sheetName+"</div>");

				this.data.push([]);
				this.dataFormulas.push([]);
				this.selectedCellsPerSheet.push([[0,0],[0,0]]);
			}

			$('.sheet-tabs-holder .sheet-tab').eq(this.activeSheet).addClass('active');

			// switch to first sheet
			this.switchSheet(0);
		}

		this.switchSheet = function(index){

			// store current selectedCells in selectedCellsPerSheet
			this.selectedCellsPerSheet[this.activeSheet] = this.selectedCells;
			this.activeSheet = index;
			this.selectedCells = this.selectedCellsPerSheet[this.activeSheet];

			$('.sheet-tabs .sheet-tab').eq(index).addClass('active').siblings().removeClass('active');

			this.wsManager.send({arguments: ["SWITCHSHEET", this.activeSheet+""]})

			this.setSheetSize(this.sheetSizes[this.activeSheet][0], this.sheetSizes[this.activeSheet][1]);

			// drawSheet is required for positionViewOnSelectedCells to work TODO: decouple
			this.drawSheet();

			this.positionViewOnSelectedCells();

			this.refreshView();
		}

		this.initSheetTabs = function(){
			$('.sheet-tabs').on('click', '.sheet-tab', function(){
				_this.switchSheet($(this).index());
			});

			$('.add-sheet').click(function(){
				var numberOfCurrentSheets = _this.sheetSizes.length;
				var sheetName = prompt("Enter a name", "Sheet" + (numberOfCurrentSheets+1));

				if(sheetName.length != 0){
					_this.wsManager.send({arguments: ["ADDSHEET", sheetName]});
				}else{
					alert("You have to enter a sheet name, aborting.");
				}
			});

			$('.sheet-tabs').on('dblclick', '.sheet-tab', function(){

				var tabIndex = $(this).index();

				if($('.sheet-tabs .sheet-tab').length == 1){
					alert("You can't remove the last sheet.");
					return
				}

				var remove = confirm("Are you sure you want to remove sheet: "+$(this).text()+"?");

				if(remove){
					_this.wsManager.send({arguments:["REMOVESHEET",tabIndex+""]})
				}
				
			});
		}

		this.updateOffset = function(){
			this.scrollOffsetX = this.sheetDom.scrollLeft;
			this.scrollOffsetY = this.sheetDom.scrollTop;
		}

		this.markSaving = function(){
			$(".save-status").html("Saving workspace...");
		}

		this.markSaved = function(){
			$(".save-status").html("Saved.");
		}
		this.markUnsaved = function(){
			$(".save-status").html("There are unsaved changes");
		}

		this.init = function(){

			// initialize editor
			// this.editor.init();

			// initialize codeGen
			this.codeGen.init();

			// get workspace details
			this.getWorkspaceDetails();

			// initialize wsManager
			this.wsManager.init();

			// initialize unit testing manager
			this.testManager.init();

			this.wsManager.ws.onclose = function(){
				var destr = confirm("Lost connection to the server. Redirect to dashboard?");

				if(destr) {
					setTimeout(function(){
						var currentUrl = window.location.href;
						var newUrl = currentUrl.replace("/workspace/","/destruct/");
						window.location.href = newUrl;
					},100);
				}
			}

			this.wsManager.onconnect = function(){
				_this.refreshView();
				// _this.getSheets();
				_this.fileManager.init();
			}

			this.registerContextMenu();

			// initialize terminal
			// this.termManager.init();

			this.initTabs();

			this.initStaticPlots();

			this.initSheetTabs();

			this.menuInit();

			// init input
			this.init_input();
			
			this.initRowCols();

			this.initImagePlotTab();

			this.sheetSizer.appendChild(this.canvas);
			this.sizeSizer();

			this.drawSheet();

			this.sheetDom.addEventListener('scroll',function(e){

				_this.updateOffset();

				// draw canvas on scroll event
				_this.drawSheet();

			});

			
			
			// resize listener
			window.addEventListener('resize',function(){
				_this.resizeSheet();
				_this.drawSheet();
			});
			
			this.isFocusedOnElement = function(){

				var focused_on_input = false;

				$('input').each(function(){
					if($(this).is(":focus")){
						focused_on_input = true;
					}
				});
				
				if(!focused_on_input && !_this.input_field.is(':focus') && !_this.formula_input.is(":focus") && !_this.editor.ace.isFocused() && !_this.termManager.isFocused()){
					return false;
				}else{
					return true;
				}
			}

			// mouse down listener canvas
			this.sheetDom.addEventListener('dblclick',function(e){

				e.preventDefault();
				
				// prevent double click when clicking in plot
				if($(e.target).parents('.plot').length == 0){


					if(e.which == 1 && !_this.input_field.is(':focus')){

						
						var canvasMouseX = e.offsetX - _this.sheetDom.scrollLeft;
						var canvasMouseY = e.offsetY - _this.sheetDom.scrollTop;

						// check if dblclick location is in indicator area, if so, resize closes column to default rowheight
						if(canvasMouseX < _this.sidebarSize[0] || canvasMouseY < _this.sidebarSize[1]){
							
							var type = 'column';
							if( canvasMouseX < _this.sidebarSize[0]){
								type = 'row';
							}

							var cell = _this.positionToCellDivider(canvasMouseX, canvasMouseY, type);

							
							if(type == 'column'){

								// _this.columnWidths(cell[1],_this.cellWidth);
								_this.wsManager.send({arguments: ["MAXCOLUMNWIDTH", (cell[1]+1) + "", _this.activeSheet + ""]});
								
							}else{

								_this.rowHeights(cell[0], _this.cellHeight);

							}

							// redraw with new columnWidht/rowHeights
							_this.computeScrollBounds();

							_this.drawSheet();

						}else{

							// if not double click on sidebar, open cell in location
							_this.show_input_field();
							
							var range = document.createRange();
							range.setStart(_this.input_field[0],0);
							range.setEnd(_this.input_field[0], 0);

						}
	
					}
				}
				
				
			});

			this.selectCell = function(cell) {
				this.selectedCells = [cell, cell];
				// also fill formulabar

				var formula_value = this.get_formula(cell, this.activeSheet);
				if(formula_value !== undefined){
					this.formula_input.val(formula_value);
				}else{
					this.formula_input.val(formula_value);		
				}
			}

			this.resizingIndicator = false;
			this.resizingIndicatorType = 'column';
			this.resizingIndicatorCell = undefined;
			this.resizingIndicatorPosition = [0,0];

			this.sheetDom.addEventListener('mousedown',function(e){

				var canvasMouseX = e.offsetX - _this.sheetDom.scrollLeft;
				var canvasMouseY = e.offsetY - _this.sheetDom.scrollTop;

				if(e.which == 1 && !_this.input_field.is(':focus')){

					// also check for sheetSizer (for scrollbar), don't fall through to deselect_input_field
					if(e.target == _this.sheetSizer){
						_this.mouse_down_canvas = true;
						
						// check if in indicator ranges -- resize column/rows
						if(canvasMouseX < _this.sidebarSize[0] || canvasMouseY < _this.sidebarSize[1]){
							_this.resizingIndicator = true;

							_this.resizingIndicatorPosition = [e.offsetX, e.offsetY];

							if(canvasMouseX < _this.sidebarSize[0]){
								_this.resizingIndicatorType = 'row';
							}else{
								_this.resizingIndicatorType = 'column';
							}

							var cell = _this.positionToCellDivider(canvasMouseX, canvasMouseY, _this.resizingIndicatorType);
							
							_this.resizingIndicatorCell = cell;
							
							// identify which rowHeight or columnHeight should be transformed

							// cell[0] <- row
							// cell[1] <- column

						}else{
							// select cells

							var cell = _this.positionToCellLocation(canvasMouseX, canvasMouseY);

							if(e.shiftKey){
								// set both cells
								_this.selectedCells[1] = cell;
							}else{
								// set both cells
								_this.selectCell(cell);
							}
			
							// render cells
							_this.drawSheet();

						}
						
					}
					
				}else{
					// if clicked on sheetDom deselect
					if(e.target != _this.input_field[0] && _this.input_field.is(':focus')){

						// if clicked outside of input field, while input field is open append reference of current click position in input
						var clickedCellPosition = _this.positionToCellLocation(canvasMouseX,canvasMouseY);
						var clickedCellRef = _this.cellZeroIndexToString(clickedCellPosition[0], clickedCellPosition[1]);
						_this.input_field.val(_this.input_field.val() + clickedCellRef);
						e.preventDefault();
						// closing the input can be done either through ESC key or pressing enter.
					}
				}
				
			});

			// mouse move listener
			this.sheetDom.addEventListener('mousemove',function(e){

				var canvasMouseX = e.offsetX - _this.sheetDom.scrollLeft;
				var canvasMouseY = e.offsetY - _this.sheetDom.scrollTop;

				_this.lastMousePosition = [canvasMouseX, canvasMouseY];

				if(_this.mouse_down_canvas){

					if(_this.resizingIndicator){
						
						var diff = [e.offsetX - _this.resizingIndicatorPosition[0], e.offsetY - _this.resizingIndicatorPosition[1]];
						
						if(_this.resizingIndicatorType == 'column'){
							// resizing column
							var index =_this.resizingIndicatorCell[1];
							_this.columnWidths(index, _this.columnWidths(index) + diff[0]);
							
							if(_this.columnWidths(index) < _this.minColRowSize){
								_this.columnWidths(index, _this.minColRowSize);
							}
						}else{
							// resizing row
							var index =_this.resizingIndicatorCell[0];
							
							_this.rowHeights(index, _this.rowHeights(index) + diff[1]);
							
							if(_this.rowHeights(index) < _this.minColRowSize){
								_this.rowHeights(index,  _this.minColRowSize);
							}
						}

						// re-draw after resize
						_this.drawSheet();

						_this.resizingIndicatorPosition = [e.offsetX, e.offsetY];
						
					}else{

						// drag operation
					
						// set end cell selection as end cell
						var cell = _this.positionToCellLocation(e.offsetX - _this.sheetDom.scrollLeft, e.offsetY - _this.sheetDom.scrollTop);
						
						// redraw selection if new cell
						if(cell != _this.selectedCells[1]){
							_this.selectedCells[1] = cell.slice();

							_this.drawSheet();
						}

					}
					
					
				}

			});

			// mouse up listener
			document.body.addEventListener('mouseup',function(){
				_this.mouse_down_canvas = false;

				if(_this.resizingIndicator){
					_this.resizingIndicator = false;
					// recompute bounds on mouse up
					_this.resizeSheet();
					_this.drawSheet();
				}
				
			});

			document.body.addEventListener('paste', function(e){

				if(!_this.isFocusedOnElement()){
					// _this.set_range(_this.selectedCells[0], _this.selectedCells[1], event.clipboardData.getData('Text'));
					
					// // redraw
					// _this.drawSheet();
				}
				
			});

			// register keyboard listener
			document.body.addEventListener('keydown',function(e){

				var keyRegistered = true;

				// escape
				if(e.keyCode == 27){

					// either back out input action or deselect
					if(_this.input_field.is(":focus")){
						
						// put back backup value back
						// _this.input_field.val(_this.init_input_field_backup_value);					
						_this.deselect_input_field(false);
					}else{
						// _this.selectedCells = undefined;
						_this.drawSheet();
					}
					
				}
				// left arrow
				else if(e.keyCode >= 37 && e.keyCode <= 40){

					if(!_this.isFocusedOnElement()){
						
						if(e.keyCode == 37){
							_this.translateSelection(-1, 0, e.shiftKey, e.ctrlKey || e.metaKey);
						}
						// up arrow
						else if(e.keyCode == 38){
							_this.translateSelection(0, -1, e.shiftKey, e.ctrlKey || e.metaKey);
						}
						// right arrow
						else if(e.keyCode == 39){
							_this.translateSelection(1, 0, e.shiftKey, e.ctrlKey || e.metaKey);
						}
						// down arrow
						else if(e.keyCode == 40){
							_this.translateSelection(0, 1, e.shiftKey, e.ctrlKey || e.metaKey);
						}
					}else{
						// fall through allow normal arrow key movement in input mode
						keyRegistered = false;
					}
				}
				else if(e.keyCode == 13){
					if (e.ctrlKey) {
						$(_this.dom).find('div-menu').find('menu-item.run').click();
					}
					return;
					if(_this.isFocusedOnElement()){
						
						if(_this.formula_input.is(":focus")){
							var inputValue = _this.formula_input.val();
							_this.set_formula(_this.selectedCells[0], inputValue, true, _this.activeSheet);
							_this.formula_input.blur();
						}
						else if(_this.input_field.is(":focus")){
							// defocus, e.g. submit to currently selected field
							_this.deselect_input_field(true);
	
							// set focus to next cell
							var nextCell = _this.selectedCells[0];
							_this.translateSelection(0, 1, false, false);
	
						}else{
							keyRegistered = false;
						}
						
					}else{
						
						_this.show_input_field();
						
					}
					
				}
				else if(e.keyCode == 8) {
					if (document.activeElement.tagName !== 'INPUT') {
						_remove_d3_element();
					} else {
						return true;
					}
				}
				else if(e.keyCode == 9){
					
					if(_this.isFocusedOnElement()){
						
						if(_this.input_field.is(":focus")){
							// defocus, e.g. submit to currently selected field
							_this.deselect_input_field(true);
						}

						var nextCell = _this.selectedCells[0];

						_this.translateSelection(1, 0, false, false);
						
					}else{
						var nextCell = _this.selectedCells[0];
						nextCell[1]++;
						_this.selectCell(nextCell);

						_this.drawSheet();
					}
					
				}
				else if(e.keyCode == 9){

					if(_this.input_field.is(":focus")){
						
						_this.deselect_input_field(true);

						// set focus to next cell
						var nextCell = _this.selectedCells[0];
						nextCell[1]++;
						_this.selectCell(nextCell);

					}else{
						keyRegistered = false;
					}

				}
				else if(e.keyCode == 187 || e.keyCode == 61){
					if(!_this.isFocusedOnElement()){
						_this.show_input_field();
						_this.input_field.val("=");
					}else{
						keyRegistered = false;
					}
				}
				// delete
				else if(e.keyCode == 46){
					// delete value in current cell
					if(!_this.isFocusedOnElement()){
						_this.deleteSelection();
						_this.formula_input.val('');
					}else{
						keyRegistered = false;
					}

				}
				else if(!e.ctrlKey && !e.metaKey && (e.keyCode == 32 || (e.keyCode >= 48 && e.keyCode <= 57) || (e.keyCode >= 65 && e.keyCode <= 90))){

					// any of the letters and the space
					if(!_this.isFocusedOnElement()){

						// _this.set_formula(_this.selectedCells[0], '');

						_this.show_input_field();
						// replace value in current field
						_this.input_field.val('');
					}

					// however, don't absorb
					keyRegistered = false;					
				}
				else if(
					(e.ctrlKey && (e.keyCode == 67)) ||
					(e.metaKey && (e.keyCode == 67))) {

					if(!_this.isFocusedOnElement()){
						
						_this.copySelection();

					}else{
						keyRegistered = false;
					}
						
					
				}
				else if(
					(e.ctrlKey && (e.keyCode == 88)) ||
					(e.metaKey && (e.keyCode == 88))) {

					if(!_this.isFocusedOnElement()){
						
						_this.cutSelection();

					}else{
						keyRegistered = false;
					}
					
				}
				else if(
					(e.ctrlKey && (e.keyCode == 86)) ||
					(e.metaKey && (e.keyCode == 86))) {

					if(!_this.isFocusedOnElement()){
						
						if(e.shiftKey){
							_this.pasteSelectionAsValue();
						}else{
							_this.pasteSelection();
						}

					}else{
						keyRegistered = false;
					}
				}
				else if((e.ctrlKey || e.metaKey) && e.keyCode == 83) {

					if(!_this.isFocusedOnElement()){
						_this.saveWorkspace();
					}else{
						keyRegistered = false;
					}

				}
				else if((e.ctrlKey || e.metaKey) && e.keyCode == 65) {

					if(!_this.isFocusedOnElement()){
						
						// select all cells
						_this.selectedCells = [[0,0], [_this.sheetSizes[_this.activeSheet][0]-1, _this.sheetSizes[_this.activeSheet][1]-1]]
						
						// update draw
						_this.drawSheet();

					}else{
						keyRegistered = false;
					}

				}
				else{
					keyRegistered = false;			
				}

				if(keyRegistered){
					e.preventDefault();
				}

			});
		}

		this.updateSheetSize = function(rowCount, columnCount, sheetIndex){

			this.sheetSizes[sheetIndex] = [rowCount, columnCount];

			if(sheetIndex == this.activeSheet){
				this.setSheetSize(rowCount, columnCount);
				this.refreshView();
			}
		}

		this.setSheetSize = function(rows, columns){

			this.numRows = rows;
			this.numColumns = columns;

			this.resizeSheet();
		}

		this.cellArrayToStringRange = function(cellRange){
			var cellIndexStringStart = this.cellZeroIndexToString(cellRange[0][0], cellRange[0][1]);
			var cellIndexStringEnd = this.cellZeroIndexToString(cellRange[1][0], cellRange[1][1]);
			return cellIndexStringStart + ":" + cellIndexStringEnd;
		}

		this.refreshView = function(){
			
			// first get the view based on current scroll position 
			// (horizontally which columns are in view, vertically which rows are in view)

			// send websocket request for this range
			var rangeString = this.cellArrayToStringRange([[this.drawRowStart, this.drawColumnStart],[this.drawRowEnd, this.drawColumnEnd]]);

			this.refreshDataRange(rangeString, this.activeSheet);

			// also refresh plot
			this.reloadPlotsData();
		}

		this.refreshDataRange = function(range, sheetIndex){
			this.wsManager.send('{"arguments":["GET","'+range+'","'+sheetIndex+'"]}')
		}

		this.deselect_input_field = function(set_values){
			_this.input_field.blur();
			
			if(_this.selectedCells != undefined && set_values === true){
				_this.set_range(_this.selectedCells[0], _this.selectedCells[0], _this.input_field.val());
			}
			
			// clear value from input field
			_this.input_field.val('');
			_this.input_field.hide();

		}

		this.show_input_field = function(){


			// position input field
			// prefill with value in current cell
			var formula = this.get_formula(this.selectedCells[0], this.activeSheet);

			// if formula is string, remove prefix =" and suffix "
			if(formula && formula[0] == "=" && formula[1] == '"' && formula[formula.length-1] == '"'){
				formula = formula.substring(2,formula.length-1);
			}

			// if formula contains error string in formula, remove error message
			if(formula && formula[0] == "E" && formula.indexOf("Error in formula:") != -1){
				formula = "=" + formula.replace("Error in formula: ", "");
			}

			if(formula && formula[0] == "C" && formula.indexOf("Circular reference:") != -1){
				formula = "=" + formula.replace("Circular reference: ", "");
			}

			this.input_field.val(formula);

			this.init_input_field_backup_value = this.input_field.val();
			
			// first: position for what cell?
			var cellPosition = this.cellLocationToPosition(this.selectedCells[0]);

			// size this cell
			var cellWidth = this.columnWidths(this.selectedCells[0][1]); // index 0, 1 is column
			var cellHeight = this.rowHeights(this.selectedCells[0][0]); // index 0, 0 is row

			// special sizing due to Canvas+HTML combination
			this.input_field.css({width: cellWidth-1, height: cellHeight-1});

			// draw input at this position
			this.input_field.css({marginLeft: cellPosition[0] + 1 + this.sidebarSize[0], marginTop: cellPosition[1] + 1 + this.sidebarSize[1]});
			
			this.input_field.show();
			this.input_field.focus();
			
		}

		this.deleteSelection = function(){
			var lower_upper_cells = this.selectionToLowerUpper(this.selectedCells);

			var startCell = this.cellZeroIndexToString(lower_upper_cells[0][0],lower_upper_cells[0][1]);
			var endCell =  this.cellZeroIndexToString(lower_upper_cells[1][0],lower_upper_cells[1][1]);

			// delete visible cells from cache
			for(var r = lower_upper_cells[0][0]; r <= lower_upper_cells[1][0]; r++){

				if(r < this.drawRowStart){
					r = this.drawRowStart;
				}
				if(r > this.drawRowEnd){
					break;
				}

				for(var c = lower_upper_cells[0][1]; c <= lower_upper_cells[1][1]; c++){

					if(c < this.drawColumnStart){
						c = this.drawColumnStart;
					}
					if(c > this.drawColumnEnd){
						break;
					}

					if(this.data[this.activeSheet][r]){
						this.data[this.activeSheet][r][c] = undefined;
					}
					if(this.dataFormulas[this.activeSheet][r]){
						this.dataFormulas[this.activeSheet][r][c] = undefined;
					}
				}
			}

			_this.wsManager.send({arguments: ["RANGE","SETSINGLE",  startCell+":"+endCell, _this.activeSheet+"", ""]});
		}

		this.selectionToLowerUpper = function(selectedCells){
			var cell1 = selectedCells[0].slice();
			var cell2 = selectedCells[1].slice();

			var columnBegin = cell1[1];
			var columnEnd = cell2[1];

			var rowBegin = cell1[0];
			var rowEnd = cell2[0];

			// swap cells if one is before other
			if(columnEnd < columnBegin){
				var tmp = columnBegin;
				columnBegin = columnEnd;
				columnEnd = tmp;
			}

			if(rowEnd < rowBegin){
				var tmp = rowBegin;
				rowBegin = rowEnd;
				rowEnd = tmp;
			}



			return [[rowBegin, columnBegin], [rowEnd,columnEnd]];
		}

		// signature (requires lower cell, to higher cell)
		this.set_range = function(cell, ending_cell, value){

			// delete range
			var cellRangeSize = this.cellRangeSize(cell, ending_cell);
			for(var x = 0; x < cellRangeSize[0]; x++){
				for(var y = 0; y < cellRangeSize[1]; y++){
					var current_cell = [cell[0] + y, cell[1] + x];
					this.set_formula(current_cell, value, true, this.activeSheet);
				}
			}
			
			this.drawSheet();
		}

		this.findFirstTypeCell = function(startCell, direction, cb){

			this.callbacks.jumpCellCallback = cb;
			this.wsManager.send({arguments: ["JUMPCELL", startCell, direction, ""+this.activeSheet]});

			// var currentCell = startCell;

			// // check for row (row_or_column = 0), check for column (row_or_column = 1)
			// while(true){
			// 	currentCell[row_or_column] += direction; // decrements cell in case of direction -1

			// 	if(type == 'nonempty'){

			// 		if(this.get(currentCell) != undefined && this.get(currentCell) != ''){
			// 			break;
			// 		}
			// 		else if(this.get(currentCell) == undefined){
			// 			// undo last step to get to existent cell
			// 			currentCell[row_or_column] -= direction;
			// 			break;
			// 		}

			// 	}else if(type == 'empty'){

			// 		if(this.get(currentCell) === undefined){
						
			// 			// undo last step to get to existent cell
			// 			currentCell[row_or_column] -= direction;
			// 			break;
			// 		}
			// 		if(this.get(currentCell) == ''){

			// 			// undo last step to get to existent cell
			// 			currentCell[row_or_column] -= direction;
			// 			break;
			// 		}

			// 	}else{
			// 		break;
			// 	}
			// }

			// return currentCell;
		}

		this.translateSelection = function(dx, dy, shift, ctrl){

			// set it equal to copy
			var cell = this.selectedCells[0].slice();
			var _this = this;
			
			if(shift){
				// create copy
				cell = this.selectedCells[1].slice();
			}

			if(ctrl){
				// transform dx and dy based on direction and first empty cell in this direction
				// var row_or_column = 0;
				// var direction = dy;

				// if(dy == 0){
				// 	row_or_column = 1;
				// 	direction = dx;
				// }

				// for empty cells go to first non-empty
				// var currentNextCell = cell;

				// var currentCellValue = this.get(currentNextCell);

				// if the current cell is empty not empty, check whether next cell is empty
				// if(currentCellValue != ''){
				// 	currentNextCell[0] += dy;
				// 	currentNextCell[1] += dx; // move cell to next intended position

				// 	var currentNextCellValue = this.get(currentNextCell);
				// 	// protect against undefined location
				// 	if(currentNextCellValue == undefined){
				// 		currentNextCellValue = this.get(cell);
				// 	}
				// }else{
				// 	var currentNextCellValue = currentCellValue;
				// }

				var direction = "up";
				if(dx < 0){
					direction = "left";
				}else if (dx > 0){
					direction = "right";
				}else if (dy > 0){
					direction = "down";
				}
				
				// on ctrl jump make this asynchronously
				this.findFirstTypeCell(this.cellZeroIndexToString(cell[0],cell[1]), direction, function(cell){

					_this.selectedCells[1] = cell;

					// set back to global
					if(!shift){
						_this.selectCell(cell);
					}
					
					_this.positionViewOnSelectedCells();
				});

				// if(currentNextCellValue == '' || currentNextCellValue == undefined){

				// 	// console.log("Check for non empty cell");
					

				// }
				// // for non-empty cells go to first empty
				// else{

				// 	// console.log("Check for empty cell");
					
				// 	cell = this.findFirstTypeCell(cell, row_or_column, direction, 'empty');

				// }

			}else{
				cell = this.translateCell(cell, dx, dy);

				// set back to global
				if(!shift){
					this.selectCell(cell);
				}

				// set second cell equal to first cell
				this.selectedCells[1] = cell;
				
				this.positionViewOnSelectedCells();		
			}
			
		}

		this.positionViewOnSelectedCells = function(){
			///// BLOCK: overflow key navigation and view-port correction

			// after re-position compare selectedCell (1) with visible cells
			var orderedCells = this.getSelectedCellsInOrder();

			var sheetViewWidth = this.sheetDom.clientWidth;
			var sheetViewHeight = this.sheetDom.clientHeight;

			var cellToCenterOn = orderedCells[1];

			if(cellToCenterOn[0] < this.drawRowStart){

				// set vertical scroll to cellToCenterOn[1] position
				var newScrollOffsetY = (this.sheetSizer.clientHeight - sheetViewHeight) * (cellToCenterOn[0] / this.finalRow);
				this.sheetDom.scrollTop = newScrollOffsetY;

			}
			if(cellToCenterOn[1] < this.drawColumnStart){

				// set horizontal scroll to cellToCenterOn[1] position
				var newScrollOffsetX = (this.sheetSizer.clientWidth - sheetViewWidth) * (cellToCenterOn[1] / this.finalColumn);
				this.sheetDom.scrollLeft = newScrollOffsetX;

			}

			// consider overflow on bottom end, compute boundarycell based on height/width data incremented from current drawRowstart
			var viewEndRow = this.drawRowStart;
			var measuredHeight = 0;

			// endless loop until maximum last row
			while(viewEndRow < this.numRows){

				measuredHeight += this.rowHeights(viewEndRow);
				
				// increment to next row
				if (measuredHeight >= (sheetViewHeight - this.sidebarSize[1])){

					// exclude finalRow since not fully in view
					viewEndRow--;
					break;
				}else{
					viewEndRow++;
				}
			}

			var viewEndColumn = this.drawColumnStart;
			var measureWidth = 0;

			// endless loop until maximum last row
			while(viewEndColumn < this.numColumns){

				measureWidth += this.columnWidths(viewEndColumn);

				// increment to next row
				if (measureWidth >= (sheetViewWidth - this.sidebarSize[0])){
					// exclude finalColumn since not fully in view
					viewEndColumn--;
					break;
				}else{
					viewEndColumn++;
				}
			}

			if(cellToCenterOn[0] > viewEndRow){

				// compute the firstcell that needs to be selected in order to have the whole of the targetcell (orderedCells[0][0]) in view

				// compute downwards
				var minimumFirstRow = cellToCenterOn[0];
				var measuredHeight = 0;
				
				// endless loop until maximum last row
				while(minimumFirstRow >= 0){

					measuredHeight += this.rowHeights(minimumFirstRow);
					
					// increment to next row
					if (measuredHeight >= (sheetViewHeight - this.sidebarSize[1])){
						// exclude final row since not fully in view
						minimumFirstRow++;
						break;
					}else{
						minimumFirstRow--;
					}
				}
				
				// set vertical scroll to cellToCenterOn[1] position
				var newScrollOffsetY = (this.sheetSizer.clientHeight - sheetViewHeight) * (minimumFirstRow / this.finalRow);
				this.sheetDom.scrollTop = newScrollOffsetY;

			}

			if(cellToCenterOn[1] > viewEndColumn){

				// compute downwards
				var minimumFirstColumn = cellToCenterOn[1];
				var measureWidth = 0;
				
				// endless loop until maximum last row
				while(minimumFirstColumn >= 0){

					measureWidth += this.columnWidths(minimumFirstColumn);
					
					// increment to next row
					if (measureWidth >= (sheetViewWidth - this.sidebarSize[0])){
						// exclude final row since not fully in view
						minimumFirstColumn++;
						break;
					}else{
						minimumFirstColumn--;
					}
				}

				// set horizontal scroll to cellToCenterOn[1] position
				var newScrollOffsetX = (this.sheetSizer.clientWidth - sheetViewWidth) * (minimumFirstColumn / this.finalColumn);
				this.sheetDom.scrollLeft = newScrollOffsetX;

			}

			this.updateOffset();

			// redraw
			this.drawSheet();
		}

		this.translateCell = function(cell, dx, dy){
			
			// row
			cell[0] += dy;

			// column
			cell[1] += dx;
			

			if(cell[0] < 0){
				cell[0] = 0;
			}
			if(cell[1] < 0){
				cell[1] = 0;
			}

			if(cell[0] >= this.numRows){
				cell[0] = this.numRows-1;
			}
			if(cell[1] >= this.numColumns){
				cell[1] = this.numColumns-1;
			}

			return cell;
		}

		this.cellLocationToPosition = function(cellPosition){
			
			// return the X, Y coordinates of the cell or undefined if the cell is not being rendered
			
			// check whether the cells are within the view bound
			// if(cellPosition[0] < this.drawRowStart || cellPosition[1] < this.drawColumnStart){
			// 	return undefined;
			// }else{

				
			// }

			// TODO: for now don't check bounds

			// calculate the y axis (the row)
			var y = 0;
			var currentRowHeight = 0;
			
			currentRowHeight = cellPosition[0] * this.cellHeight;
			for(var key in this.rowHeightsCache){
				if(parseInt(key) < cellPosition[0]){
					currentRowHeight += this.rowHeightsCache[key];
					currentRowHeight -= this.cellHeight;
				}
			}

			if(currentRowHeight - this.sheetOffsetY > this.sheetDom.clientHeight){
				return undefined;
			}else{
				y = currentRowHeight - this.sheetOffsetY;
			}

			var x = 0;
			var currentColumnWidth = 0;
			
			currentColumnWidth = cellPosition[1] * this.cellWidth;
			for(var key in this.columnWidthsCache){
				if(parseInt(key) < cellPosition[1]){
					currentColumnWidth += this.columnWidthsCache[key];
					currentColumnWidth -= this.cellWidth;
				}
			}

			if(currentColumnWidth - this.sheetOffsetX > this.sheetDom.clientWidth){
				return undefined;
			}else{
				x = currentColumnWidth - this.sheetOffsetX;
			}

			return [x, y];
		}

		this.positionToCellLocation = function(x, y){

			var rowX = x + this.sheetOffsetX - this.sidebarSize[0];
			var columnIndex = 0;
			var currentColumnWidth = 0;

			for(var i = 0; i < this.numColumns; i++){

				currentColumnWidth += this.columnWidths(i);
				if(currentColumnWidth >= rowX || i+1 == this.numColumns){
					columnIndex = i;
					break;
				}
			}

			var rowY = y + this.sheetOffsetY - this.sidebarSize[1];
			var rowIndex = 0;
			var currentRowHeight = 0;

			for(var i = 0; i < this.numRows; i++){
				currentRowHeight += this.rowHeights(i);
				if(currentRowHeight >= rowY || i+1 == this.numRows){
					rowIndex = i;
					break;					
				}
			}

			return [rowIndex, columnIndex];
		}

		this.positionToCellDivider = function(x, y, type){
			
			var rowIndex = 0;
			var columnIndex = 0;
			
			// optimize efficiency due to never being able to resize both column and row
			if(type == 'column'){
				var rowX = x + this.sheetOffsetX - this.sidebarSize[0];
				var currentColumnWidth = 0;
	
				for(var i = 0; i < this.numColumns; i++){
	
					currentColumnWidth += this.columnWidths(i);
					if(currentColumnWidth >= rowX){
						columnIndex = i;
	
						var dist1 = Math.abs(rowX - currentColumnWidth);
						var dist2 = Math.abs(rowX - (currentColumnWidth - this.columnWidths(i)));
	
						// if currentColumndWidth -= this.columnsWidths[i] is closer, choose that column
						if(dist2 < dist1){
							columnIndex = i - 1;
						}
						
						break;
					}
				}
			}else{
				var rowY = y + this.sheetOffsetY - this.sidebarSize[1];
				var currentRowHeight = 0;
	
				for(var i = 0; i < this.numRows; i++){
					currentRowHeight += this.rowHeights(i);
					if(currentRowHeight >= rowY){
						rowIndex = i;
	
						var dist1 = Math.abs(rowY - currentRowHeight);
						var dist2 = Math.abs(rowY - (currentRowHeight - this.rowHeights(i)));
	
						// if currentRowHeight -= this.rowHeights(i) is closer, choose that row
						if(dist2 < dist1){
							rowIndex = i - 1;
						}
	
						break;					
					}
				}
			}

			return [rowIndex, columnIndex];
		}

		this.rowHeights = function(index, value){
			if(value === undefined){
				if(this.rowHeightsCache[index] === undefined){
					return this.cellHeight;
				}else{
					return this.rowHeightsCache[index];
				}
			}else{
				this.rowHeightsCache[index] = value;
			}
		}

		this.columnWidths = function(index, value){
			if(value === undefined){
				if(this.columnWidthsCache[index] === undefined){
					return this.cellWidth;
				}else{
					return this.columnWidthsCache[index];
				}
			}else{
				this.columnWidthsCache[index] = value;
			}
		}

		this.initRowCols = function(){

			// config
			this.cellHeight = 20;
			this.cellWidth = 100;

			// add for testing
			this.computeRowHeight();
			this.computeColumnWidth();
			this.computeScrollBounds();
			
		}

		this.computeScrollBounds = function(){

			var width = this.sheetDom.clientWidth;
			var height = this.sheetDom.clientHeight;

			var totalHeight = 0;
			var totalWidth = 0;
			var finalColumn = 0;
			var finalRow = 0;

			for(var y = this.numRows-1; y >= 0; y--){

				totalHeight += this.rowHeights(y);
				if(totalHeight < height-this.sidebarSize[1]){
					finalRow = y; // choose starting cell that guarantees that it will be in view
				}else{
					break;
				}
				
			}

			// interpolate linearly between 0 and finalRow
			for(var x = this.numColumns-1; x >= 0; x--){

				totalWidth += this.columnWidths(x);
				if(totalWidth < width-this.sidebarSize[0]){
					finalColumn = x + 1;
				}else{
					break;
				}
			}
			this.finalRow = finalRow;
			this.finalColumn = finalColumn;

		}
		
		this.codeOpen = true;
		
		this.resizeSheet = function(){
			this.computeScrollBounds();
			this.sizeSizer();
		}
		
		this.toggleCode = function(){
			if (this.codeOpen){
				
				// close editor
				$(this.editor.dom).css({width: 0})
				$('.left-panel').css({width: '100%'});
				
			}else{
				
				// open editor
				$(this.editor.dom).css({width: ''})
				$('.left-panel').css({width: ''});
			}
			
			this.codeOpen = !this.codeOpen;

			// resize spreadsheet
			this.resizeSheet();
			this.drawSheet();
		}
		
		this.openFile = function(){
			
			var input = $(this.dom).find('menu-item.load-csv input');
			input.click();
		}
		
		this.openFileUpload = function(){
			var input = $(this.dom).find('menu-item.upload-file input');
			input.click();
		}
		
		this.uploadCSV = function(){
				
			var input = $(this.dom).find('menu-item.load-csv input');
			
			var reader = new FileReader();

			reader.onload = function(e){
				
				var data = e.target.result;
				
				// console.log(data);
				
				// send data through WS
				_this.wsManager.send({arguments: ["CSV", data]});
			}
			
			reader.readAsText(input[0].files[0]);

			// reset to empty to detect new uploads
			input.val("");
			
		}
		
		this.uploadFile = function(file){
			
			var formData = new FormData();

			// add assoc key values, this will be posts values
			formData.append("file", file, file.name);
			formData.append("upload_file", true);
			
			var progressHandling = function (event) {
				var percent = 0;
				var position = event.loaded || event.position;
				var total = event.total;
				
				if (event.lengthComputable) {
					percent = Math.ceil(position / total * 100);
				}
				
				console.log("File upload progress: " + percent);
				
				// update progressbars classes so it fits your code
				// $(progress_bar_id + " .progress-bar").css("width", +percent + "%");
				// $(progress_bar_id + " .status").text(percent + "%");
			};
			
			$.ajax({
				type: "POST",
				url: "uploadFile",
				xhr: function () {
					var myXhr = $.ajaxSettings.xhr();
					if (myXhr.upload) {
						myXhr.upload.addEventListener('progress', progressHandling, false);
					}
					return myXhr;
				},
				success: function (data) {
					// your callback here
					_this.showTab("filemanager");
					_this.fileManager.getDir(_this.fileManager.base_cwd);
				},
				error: function (error) {
					// handle error
				},
				async: true,
				data: formData,
				cache: false,
				contentType: false,
				processData: false,
				timeout: 60000
			});
			
		}

		this.saveWorkspace = function(){
			this.wsManager.send({arguments:["SAVE"]});
			this.markSaving();
		}

		this.exportCSV = function(){
			this.wsManager.send({arguments:["EXPORT-CSV"]});
		}

		

		const _select_dataset = (dataset) => {
			http_req('GET', 'http://localhost:5000/example/' + dataset, (resp) => {
				let node = _add_node_dataset(dataset);
				const ref = _this.graph[node.data()[0].id];
				_this.wsManager.send({arguments: ["CSV", resp]});
				ref.d = data_from_csvtext(resp);
			});
			// if (_this.dataset === undefined) {
			// } else {
				// console.log(_this.dataset);
			// }
		};

		this.menuInit = function(){

			var menu = $(this.dom).find('div-menu');

			menu.find('menu-item.about').click(function(){
				alert("Grid is a data science environment for the browser. Powered by Python & Go.");
			});

			menu.find('menu-item.save-workspace').click(function(){
				_this.saveWorkspace();
			});

			menu.find('menu-item.export-csv').click(function(){
				_this.exportCSV();
			});

			menu.find('menu-item.close-workspace').click(function(e){
				e.preventDefault();

				_this.wsManager.send({arguments:["EXIT"]})

				_this.termManager.term.socket.onclose = function(){
					_this.wsManager.ws.close();
				}

				_this.termManager.term.socket.close();

			});

			menu.find('menu-item.plot-scatter').click(function(){
				_this.plot('scatter');
			});
			menu.find('menu-item.plot-line').click(function(){
				_this.plot('line');
			});

			menu.find('menu-item.plot-histogram').click(function(){
				_this.plot('histogram');
			});
			
			menu.find('menu-item.code').click(function(){
				_this.toggleCode();
			});
			
			menu.find('menu-item.upload-file input').on('change', function(){
				var file = $(this)[0].files[0];
				_this.uploadFile(file);
			});
			
			// set up file change handler for loadCSV
			var input = $(this.dom).find('menu-item.load-csv input');
			
			input[0].addEventListener('change', function(e){
				_this.uploadCSV();
			})
			
			menu.find('menu-item.load-csv').click(function(e){
				if(!$(e.target).hasClass('csv-input')){
					_this.openFile();
				}
			});
			
			menu.find('menu-item.upload-file').click(function(e){
				if(!$(e.target).hasClass('file-input')){
					_this.openFileUpload();
				}
			});

			menu.find('menu-item.apriori').click(function(e) {
				_add_node_function('apriori')
			});

			menu.find('menu-item.capriori').click(function(e) {
				_add_node_function('capriori')
			});

			menu.find('menu-item.fpgrowth').click(function(e) {
				console.log("FP_GROWTH");
			});

			menu.find('menu-item.filter').click(function(e) {
				_add_node_function('filter')
			});

			menu.find('menu-item.kmeans').click(function(e) {
				_add_node_function('kmeans')
			});

			menu.find('menu-item.validate').click(function(e) {
				_add_node_function('validate')
			});

			menu.find('menu-item.run').click(function(e) {
				var queue = {};
				for (const [id, node] of Object.entries(_this.graph)) {
					const _id = parseInt(id);
					if (node.t == 'f') {
						queue[id] = {
							id: id,
							type: node.t,
							karg: node.d.karg,
							data: null,
							next: Array.from(node.n),
						}
					// 	var valid = true;
					// 	for (let i=0; i<node.d.args.length; ++i) {
					// 		if (!node.d.args[i]) {
					// 			valid = false;
					// 			break;
					// 		};
					// 	}
					// 	var reduced = [];
					// 	node.d.map((l) => {
					// 		if (l.length > 1) reduced.push(l);
					// 	})
					// 	if (valid) {
					// 		queue.push({
					// 			id: parseInt(id),
					// 			fc: node.d
					// 		});
					// 	}
					} else if (node.t == 'i') {
						queue[id] = {
							id: id,
							type: node.t,
							karg: {},
							data: node.d,
							next: Array.from(node.n),
						}
					}
				}
				console.log(queue);
				// return;
				socket.emit('queue', queue);
				// queue.map((q) => {
				// 	socket.emit('queue', q)
				// })
				// if (queue.length > 0) {
				// 	socket.emit('queue', queue);
				// } else {
				// 	alert("Nothing to be Run.")
				// }
			});

			menu.find('menu-item.housing').click(function(e) {
				_add_node_dataset('housing');
				
			});

			menu.find('menu-item.housing_v3').click(function(e) {
				_add_node_dataset('housing_v3');
			});

			menu.find('menu-item.housing_v5').click(function(e) {
				_add_node_dataset('housing_v5');
			});

			menu.find('menu-item.melbourne').click(function(e) {
				console.log(_this.graph);
				// http_req('GET', 'http://localhost:5000/example/test_sql', (resp) => {
				// 	_this.current_dataset = 'melbourne';
				// 	_this.wsManager.send({arguments: ["CSV", resp]});
				// });
			});

			menu.find('menu-item.demo1').click(() => {
				_clear_d3_group();

				const dataset = _add_node_dataset('housing_v3');
				const ap1 = _add_node_function('apriori');
				_connect_node(dataset, ap1);

				const ap2 = _add_node_function('apriori');
				_move_node(ap2, parseInt(ap1.attr('cx')) + 100, ap1.attr('cy'));
				_connect_node(dataset, ap2);

				_this.graph[ap1.data()[0].id].d.karg.sup = 0.5;
				
			});
			menu.find('menu-item.demo2').click(() => {
				_clear_d3_group();

				const dataset = _add_node_dataset('housing_v3');
				const ap1 = _add_node_function('apriori');
				_connect_node(dataset, ap1);
				
				const f1 = _add_node_function('filter');
				_move_node(f1, parseInt(f1.attr('cx')) + 100, f1.attr('cy'));
				_connect_node(dataset, f1);
				const ap2 = _add_node_function('apriori');
				_move_node(ap2, parseInt(f1.attr('cx')), parseInt(f1.attr('cy')) + 100);
				_connect_node(f1, ap2);

				const f2 = _add_node_function('filter');
				_move_node(f2, parseInt(f1.attr('cx')) + 100, f1.attr('cy'));
				_connect_node(dataset, f2);

				// _add_node_function('filter');
			});
			menu.find('menu-item.demo3').click(() => {
				_clear_d3_group();

				const dataset = _add_node_dataset('housing_v3');
				
				const f1 = _add_node_function('filter');
				_move_node(f1, parseInt(dataset.attr('cx')), parseInt(dataset.attr('cy')) + 100);
				_connect_node(dataset, f1);


				const f2 = _add_node_function('filter');
				_move_node(f2, parseInt(dataset.attr('cx')) + 100, parseInt(dataset.attr('cy')) + 100);
				_connect_node(dataset, f2);

				const n1 = f1.data()[0].id;
				_this.graph[n1].d.karg.arg[0].v[0] = 200000;
				_this.graph[n1].d.karg.arg[0].v[1] = 400000;

				// _this.graph[_id].d.karg.arg[f1.data()['id']]
				// _add_node_function('filter');
			});
			menu.find('menu-item.demo4').click(() => {
				_clear_d3_group();

				const dataset = _add_node_dataset('housing_v5');
				
				const f0 = _add_node_function('filter');
				_move_node(f0, parseInt(dataset.attr('cx')) + 100, parseInt(dataset.attr('cy')));
				_connect_node(dataset, f0);

				const f1 = _add_node_function('kmeans');
				_move_node(f1, parseInt(f0.attr('cx')) + 100, parseInt(dataset.attr('cy')));
				_connect_node(f0, f1);


				const f2 = _add_node_function('validate');
				_move_node(f2, parseInt(f1.attr('cx')) + 100, parseInt(dataset.attr('cy')));
				_connect_node(f1, f2);

			});
			menu.find('menu-item.demo5').click(() => {
				_clear_d3_group();

				const dataset = _add_node_dataset('housing_v5');
				
				const f0 = _add_node_function('capriori');
				_move_node(f0, parseInt(dataset.attr('cx')) + 100, parseInt(dataset.attr('cy')));
				_connect_node(dataset, f0);
			});
			
			// bind for later access
			this.menu = menu;

			// bind plot activate functions
			$(document).on('click', 'menu-item.plot-item', function(){
					
				var plot_id = $(this).attr('data-plot-id');

				var plot = $("#"+plot_id).parents('.plot');

				if(plot.is(':visible')){
					plot.hide();
					$(this).removeClass('active');
				}else{
					plot.show();
					$(this).addClass('active');
				}
				
			});
		}
		

		this.parseFloatForced = function(x){
			var num = parseFloat(x);
			if(isNaN(num)){
				num = 0;
			}
			return num;
		}

		this.plot_count = 0;

		// init at 9
		this.plot_z_index = 10000;

		this.plot_draggable = function(elem){
			
			var $elem = $(elem);
			var mouse_down = false;
			var resize = false;
			var curPosition;

			// initialize on current css value
			var position = $elem.position()
			var transform = [position.left, position.top];

			var plot_id = $elem.find('.plotly-holder').attr('id');

			$elem.find('.close').click(function(){
				// remove plot
				delete _this.plots[plot_id];
				
				// remove element
				$($elem).remove();

				// remove from menu
				_this.menu.find('menu-item[data-plot-id="'+plot_id+'"]').remove();
				
				if(_this.menu.find('.plot-list menu-item').length == 1){
					_this.menu.find('.no-plots').show();
				}
			
			})

			$elem.find('.minimize').click(function(){

				// animation
				$elem.addClass('animate');

				
				var position = $elem.position()
				var oldTransform = [position.left, position.top];

				// move transform to upper left
				$elem.css({ transform: "translate("+ (-oldTransform[0]) +"px,"+ (-oldTransform[1]) +"px)", opacity: 0});
				
				setTimeout(function(){

					// remove active from menu
					_this.menu.find('menu-item[data-plot-id="'+plot_id+'"]').removeClass('active');
					$elem.hide();
					$elem.removeClass('animate');

					// restore pre-animation variables
					$elem.css({opacity: 1, transform: ''});
				
				},300);
				
			})
			
			$elem.find('.save-svg').click(function(){
				
				Plotly.toImage(plot_id,{format:'svg', width:$elem.width(), height:$elem.height()}).then(function(data){
					
					dataURLtoBytes(data).then(function(data){
						download(data, plot_id + ".svg", "svg");
					})
				});
			
			});
			

			elem.addEventListener('mousedown', function(e){
				mouse_down = true;
				curPosition = [e.clientX, e.clientY];

				// increment z-index 
				_this.plot_z_index++;

				$elem.css({zIndex: _this.plot_z_index});

				if($(e.target).hasClass('resizer')){
					resize = true;
				}
			});

			document.addEventListener('mousemove', function(e){
				if(mouse_down){
					var diff = [e.clientX - curPosition[0], e.clientY - curPosition[1]];

					if(!resize){

						if(!$(e.target).hasClass('dragcover')){
							transform[0] += diff[0];
							transform[1] += diff[1];
	
							// move
							$elem.css({left: transform[0] + "px", top: transform[1] + "px"})
						}
						
					}else{
						// resize
						var plotly_holder = $elem.find('.plotly-holder');
						var width = plotly_holder.width();
						var height = plotly_holder.height();

						width =width+diff[0];
						height = height+diff[1];

						plotly_holder.css({width: width+"px", height: height+"px" });

						var update = {
							width: width,  // or any new width
							height: height  // " "
						};

						Plotly.relayout(plot_id, update);
					}

					

					curPosition = [e.clientX, e.clientY];
				}
				
			});
			document.addEventListener('mouseup',function(){
				mouse_down = false;
				resize = false;
			})
		}

		this.getSelectedCellsInOrder = function() {

			var selectedCellsCopy = [this.selectedCells[0],this.selectedCells[1]];

			return this.selectionToLowerUpper(selectedCellsCopy);

			// if(selectedCellsCopy[0][0] >= selectedCellsCopy[1][0] && selectedCellsCopy[0][1] >= selectedCellsCopy[1][1]){
			// 	// swap
			// 	var tmp = selectedCellsCopy[0];
			// 	selectedCellsCopy[0] = selectedCellsCopy[1];
			// 	selectedCellsCopy[1] = tmp;
			// }

		}
		
		this.get_range_float = function(range, sheetIndex){
			if(sheetIndex === undefined){
				console.error("sheetIndex must be defined for get_range_float")
			}
			return this.get_range(range[0],range[1], sheetIndex).map(this.parseFloatForced);
		}
		
		this.update_plot = function(plot){
			var x_range = plot.data[0];
			var y_range = plot.data[1];
			
			var data_update;

			data_update = {};

			data_update.type = plot.traces[0].type;
			data_update.mode = plot.traces[0].mode;

			if(y_range.length > 0){
				data_update.y = this.get_range_float(y_range, plot.sheetIndex)
			}
			if(x_range.length > 0){
				data_update.x = this.get_range_float(x_range, plot.sheetIndex)
			}

			Plotly.react(plot.plot_id,[data_update], plot.layout);

			// Plotly.relayout(plot.plot_id, {
			// 	'xaxis.autorange': true,
			// 	'yaxis.autorange': true
			// });

			// recompute 
			if(plot.type == 'histogram'){
				// TODO: re-compute the histogram bins
			}
			
		}

		this.plot = function(type){

			var x_range = [];
			var y_range = [];

			var selectedCellsOrdered = this.getSelectedCellsInOrder();

			// get current data range
			if(type == 'scatter'){

				// check width of selection
				if(selectedCellsOrdered[0][1] == selectedCellsOrdered[1][1]){
					alert("Scatter plot requires two columns");
					return;
				}
				
				x_range = [[selectedCellsOrdered[0][0],selectedCellsOrdered[0][1]],[selectedCellsOrdered[1][0],selectedCellsOrdered[1][1]-1]];
				y_range = [[selectedCellsOrdered[0][0],selectedCellsOrdered[0][1]+1],[selectedCellsOrdered[1][0],selectedCellsOrdered[1][1]]];

				var trace1 = {
					x: this.get_range_float(x_range, this.activeSheet),
					y: this.get_range_float(y_range, this.activeSheet),
					mode: 'markers',
					type: 'scatter'
				};

			}
			
			if(type == 'histogram'){
				
				x_range = [[selectedCellsOrdered[0][0],selectedCellsOrdered[0][1]],[selectedCellsOrdered[1][0],selectedCellsOrdered[1][1]]];
				
				var trace1 = {
					x: this.get_range_float(x_range, this.activeSheet),
					type: 'histogram'
				};
				// var minArray = getMinOfArray(trace1.x);
				// var maxArray = getMaxOfArray(trace1.x);
				// var bincount = (trace1.x.length/5);
				// trace1.xbins = {start:minArray, end: maxArray, size: maxArray / bincount};

			}

			if(type == 'line'){

				// detect if two or single column
				if(selectedCellsOrdered[0][1] != selectedCellsOrdered[1][1]){
					x_range = [[selectedCellsOrdered[0][0],selectedCellsOrdered[0][1]],[selectedCellsOrdered[1][0],selectedCellsOrdered[1][1]-1]];
					y_range = [[selectedCellsOrdered[0][0],selectedCellsOrdered[0][1]+1],[selectedCellsOrdered[1][0],selectedCellsOrdered[1][1]]];
					
					var trace1 = {
						x: this.get_range_float(x_range, this.activeSheet),
						y: this.get_range_float(y_range, this.activeSheet),
						mode: 'lines',
						type: 'scatter'
					};
				}else{

					y_range = [[selectedCellsOrdered[0][0],selectedCellsOrdered[0][1]],[selectedCellsOrdered[1][0],selectedCellsOrdered[1][1]]];
					
					var trace1 = {
						y: this.get_range_float(y_range, this.activeSheet),
						mode: 'lines',
						type: 'scatter'
					};

				}
				
			}
			
			// increment plot count after validation steps

			this.plot_count++;

			var plot_id = "plot-" + this.plot_count;
			var plot_div = $('<div class="plot scatter"><div class="resizer"></div><div class="plot-header"><div class="close"><img src="image/cross.svg" /></div><div class="minimize"><img src="image/dash.svg" /></div><div class="save-svg"><img src="image/floppy.svg" /></div></div><div class="plotly-holder" id="'+plot_id+'" ></div></div>');

			// position in the middle
			var plotWidth = 520;
			var plotHeight = plotWidth / (16/9);

			var offsetX = (this.sheetDom.clientWidth - plotWidth)/2;
			var offsetY = this.sheetDom.clientHeight * 0.1;

			plot_div.find("#"+plot_id).css({width: plotWidth, height: plotHeight});
			plot_div.css({left: offsetX + "px", top: offsetY + "px"})

			$('.main-body').prepend(plot_div);
			
			var layout = {
				title: type.capitalize() + " plot",
				showlegend: false,
				margin: {
					l: 40,
					r: 40,
					b: 40,
					t: 100,
					pad: 4},
				};

			Plotly.setPlotConfig({
				modeBarButtonsToRemove: ['sendDataToCloud']
			});
				
			Plotly.newPlot(plot_id, [trace1], layout,{scrollZoom: true});

			this.addPlotToMenu(plot_id);
			this.plot_draggable(plot_div[0]);
			
			// add plot
			var plotObject = {plot_id, type: type, data: [x_range, y_range], traces: [trace1], layout: layout, sheetIndex: this.activeSheet};
			this.plots[plot_id] = plotObject

			// refresh data only on initial plot
			if(x_range.length > 0){
				var rangeString = this.cellArrayToStringRange([x_range[0],x_range[1]]);
				this.refreshDataRange(rangeString, plotObject.sheetIndex);
			}

			if(y_range.length > 0){
				var rangeString = this.cellArrayToStringRange([y_range[0],y_range[1]]);
				this.refreshDataRange(rangeString, plotObject.sheetIndex);
			}

		}

		this.addPlotToMenu = function(plot_id){
			var menuList = this.menu.find('menu-list.plot-list');
			menuList.find('.no-plots').hide();
			menuList.append("<menu-item class='plot-item active' data-plot-id='"+plot_id+"'>Plot "+ this.plot_count +"</menu-item>")
		}

		this.computeColumnWidth = function(){
			return this.numColumns * this.cellWidth;
		}
		this.computedColumnWidth = this.computeColumnWidth();
		
		this.computeRowHeight = function(){
			return this.numRows * this.cellHeight;
		}
		this.computedRowHeight = this.computeRowHeight();

		this.drawSheet = function(){
			var width = this.sheetDom.clientWidth;
			var height = this.sheetDom.clientHeight;

			this.ctx.strokeStyle = '#bbbbbb';
			this.ctx.lineWidth = 1;

			// this.ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
			

			// incorporate offset in drawing

			// draw row lines
			var drawRowStart = undefined;
			var drawColumnStart = undefined;
			var measureHeight = 0;
			var measureWidth = 0;

			var firstCellHeightOffset = 0;
			var firstCellWidthOffset = 0;

			// figure out where to start drawing based on scrollOffsetY
			// TODO: replace this by percentage method that will scale well with large datasets
			var columnPercentage = this.scrollOffsetX / (this.sheetSizer.clientWidth-width);
			if(isNaN(columnPercentage)){
				columnPercentage = 0;
			}
			var rowPercentage = this.scrollOffsetY / (this.sheetSizer.clientHeight-height);
			if(isNaN(rowPercentage)){
				rowPercentage = 0;
			}

			// percentage method
			var drawRowStart = Math.round(rowPercentage * this.finalRow);

			var currentY = 0;
			var drawRowEnd = drawRowStart;
			while(true){

				if(currentY > height + this.rowHeights(drawRowEnd) || drawRowEnd > this.numRows){
					break;
				}
				currentY += this.rowHeights(drawRowEnd);
				drawRowEnd++;
			}

			// adjust sidebarSize[0] based on this number
			this.ctx.font = "9px Arial";
			var textWidth = this.ctx.measureText(drawRowEnd).width;
			this.sidebarSize[0] = textWidth + 5;
			if(this.sidebarSize[0] < this.minSidebarSize[0]){
				this.sidebarSize[0] = this.minSidebarSize[0];
			}
			

			var drawColumnStart = Math.round(columnPercentage * this.finalColumn);

			for(var x = 0; x < this.numColumns; x++){
				if(x == drawColumnStart){
					break;
				}
				measureWidth += this.columnWidths(x);
				
			}

			for(var x = 0; x < this.numRows; x++){
				if(x == drawRowStart){
					break;
				}
				measureHeight += this.rowHeights(x);
				
			}
			

			// empty cell catch
			if(drawRowStart === undefined){
				drawRowStart = this.numRows-1;
			}
			if(drawColumnStart === undefined){
				drawColumnStart = this.numColumns-1;
			}


			this.sheetOffsetY = measureHeight;
			this.sheetOffsetX = measureWidth;

			var i = drawRowStart;
			var drawHeight = 0;
			var currentY = 0;

			var horizontalLineEndX = this.efficientTotalWidth() - measureWidth;
			var verticalLineEndY = this.efficientTotalHeight() - measureHeight;


			this.ctx.beginPath();

			this.ctx.fillStyle = "#ffffff";
			this.ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);

			// this.ctx.fillStyle = "#ffffff";
			// this.ctx.fillRect(0, 0, horizontalLineEndX, verticalLineEndY);

			// render bars below navigation
			this.ctx.fillStyle = "#eeeeee";
			this.ctx.fillRect(0, 0, horizontalLineEndX, this.sidebarSize[1]);
			this.ctx.fillRect(0, 0, this.sidebarSize[0], verticalLineEndY);
			this.ctx.fillStyle = "#000000";
			

			// render horizontal lines
			// render grid

			// draw top line
			this.ctx.a_moveTo(0, 0);
			this.ctx.a_lineTo(width, 0);


			while(true){

				if(currentY > height + this.rowHeights(i) || i > this.numRows){
					break;
				}

				// draw row holder lines
				this.ctx.a_moveTo(0, currentY + firstCellHeightOffset + this.sidebarSize[1]);
				this.ctx.a_lineTo(horizontalLineEndX, currentY + firstCellHeightOffset + this.sidebarSize[1]);

				currentY += this.rowHeights(i);

				i++;
			}

			// render vertical lines
			var d = drawColumnStart;
			var drawWidth = 0;
			var currentX = 0;

			while(true){
				
				if(currentX > width + this.columnWidths(d) || d > this.numColumns){
					break;
				}

				this.ctx.a_moveTo(currentX + firstCellWidthOffset + this.sidebarSize[0], 0);
				this.ctx.a_lineTo(currentX + firstCellWidthOffset + this.sidebarSize[0], verticalLineEndY);

				currentX += this.columnWidths(d);

				d++;
			}

			this.ctx.closePath();

			this.ctx.stroke();

			// this render highlight
			this.renderHighlights();

			// if drawRow(Start/End) or drawColumn(Start/End) changes, refresh whole view

			// TODO: make refresh view partial!
			var viewInvalidated = false;
			if(this.drawRowStart != drawRowStart){
				viewInvalidated = true;
			}
			if(this.drawColumnStart != drawColumnStart){
				viewInvalidated = true;
			}

			if(this.drawRowEnd != i){
				viewInvalidated = true;
			}
			if(this.drawColumnEnd != d){
				viewInvalidated = true;
			}
			
			
			this.drawRowStart = drawRowStart;
			this.drawColumnStart = drawColumnStart;
			this.drawRowEnd = i;
			this.drawColumnEnd = d;

			// only refresh AFTER global state has updated to new drawRow/Column indexes
			// new values need to be used in refreshView call

			if(viewInvalidated){
				this.refreshView();
			}

			// render cell data
			this.renderCells(drawRowStart, drawColumnStart, i-1, d-1, firstCellHeightOffset, firstCellWidthOffset);

			
			// also re-render the input_formula field
			this.updateInputFormula();
			
		}
		
		this.updateInputFormula = function(){
			this.formula_input.val(this.get_formula(this.selectedCells[0], this.activeSheet));
		}

		this.cellRangeDistance = function(cell1, cell2){
			var xCellDistance = cell2[1] - cell1[1];
			var yCellDistance = cell2[0] - cell1[0];

			return [xCellDistance, yCellDistance];
		}

		this.cellRangeSize = function(cell1, cell2){

			var xCellDistance = (cell2[1] - cell1[1]) + 1;
			var yCellDistance = (cell2[0] - cell1[0]) + 1;

			return [xCellDistance, yCellDistance];
		}


		this.renderHighlights = function(){
			
			if(this.selectedCells){
				
				// selectedCellStart is filled
				this.ctx.fillStyle = "rgba(50, 110, 255, 0.20)";

				var cellsForSelected = this.getSelectedCellsInOrder();

				var cell_position = this.cellLocationToPosition(cellsForSelected[0]);

				var cell_1 = this.cellLocationToPosition(this.selectedCells[0]);

				// check if selected cell is in the viewport
				if(cell_position){

					// cell_1 could be undefined, if it's out of the viewport
					if(cell_1){
						// draw single cell outline
						this.ctx.strokeStyle = "rgba(50,110,255,0.8)";
						this.ctx.lineWidth = 1;

						var strokeX = cell_1[0] + this.sidebarSize[0] + 0.5;
						var strokeY = cell_1[1] + this.sidebarSize[1] + 0.5;

						if (strokeY > this.sidebarSize[1] && strokeX > this.sidebarSize[0]) {
							this.ctx.strokeRect(
								strokeX,
								strokeY,
								this.columnWidths(this.selectedCells[0][1]), 
								this.rowHeights(this.selectedCells[0][0])
							);
						}
					}

					// selectedCell index = first cell, first index is row, second index is column
					var highlightWidth = 0;
					var highlightHeight = 0;

					var cellRangeSize = this.cellRangeDistance(cellsForSelected[0], cellsForSelected[1]);

					var xCellDistance = cellRangeSize[0];
					var yCellDistance = cellRangeSize[1];

					var shiftY = 0;
					var shiftX = 0;

					if(xCellDistance < 0){
						for(var x = 0; x >= xCellDistance;x--){
							highlightWidth -= this.columnWidths(cellsForSelected[0][1] + x);
							
							if(x == 0){
								shiftX = Math.abs(highlightWidth);
							}
						}
					}else{
						for(var x = 0; x <= xCellDistance; x ++){
							highlightWidth += this.columnWidths(cellsForSelected[0][1] + x);
						}
					}

					if(yCellDistance < 0){
						for(var y = 0; y >= yCellDistance; y--){
							highlightHeight -= this.rowHeights(cellsForSelected[0][0] + y);

							if(y == 0){
								shiftY = Math.abs(highlightHeight);
							}
						}
					}else{
						for(var y = 0; y <= yCellDistance; y ++){
							highlightHeight += this.rowHeights(cellsForSelected[0][0] + y);
						}
					}
					
					
					var drawX = cell_position[0] + shiftX + this.sidebarSize[0];
					var drawY = cell_position[1] + shiftY + this.sidebarSize[1];
					var drawWidth = highlightWidth;
					var drawHeight = highlightHeight;

					// clip x and y start to this.sidebarSize
					if (drawX < this.sidebarSize[0]){
						drawWidth = drawWidth - (this.sidebarSize[0] - drawX);
						if(drawWidth < 0){
							drawWidth = 0;
						}
						drawX = this.sidebarSize[0];
					}
					if (drawY < this.sidebarSize[1]){
						drawHeight = drawHeight - (this.sidebarSize[1] - drawY);
						if(drawHeight < 0){
							drawHeight = 0;
						}
						drawY = this.sidebarSize[1];
					}
					
					this.ctx.fillRect(
						drawX,
						drawY, 
						drawWidth, 
						drawHeight);


					// draw two rectangles in left sidebar and top column bar
					this.ctx.fillStyle = "rgba(0,0,0,0.1)";
					
					this.ctx.fillRect(
						0,
						drawY,
						this.sidebarSize[0],
						drawHeight
					);

					this.ctx.fillRect(
						drawX,
						0,
						drawWidth,
						this.sidebarSize[1]
					);
				}

			}

		}
		

		this.renderCells = function(startRow, startColumn, endRow, endColumn, firstCellHeightOffset, firstCellWidthOffset){

			this.ctx.font = this.fontStyle;
			this.ctx.fillStyle = "black";
			this.ctx.textAlign = 'left';
			this.ctx.textBaseline = 'top';

			var currentX = 0;
			var currentY = 0;
			var startX = 0;

			// render one more 
			for(var i = startRow; i < endRow; i++){

				for(var d = startColumn; d < endColumn; d++){

					// compensate for borders (1px)
					var centeringOffset = ((this.rowHeights(i) + 2 - this.fontHeight)/2) + 1;

					// get data
					var cell_data = this.get([i, d], this.activeSheet);

					var cellMaxWidth = this.columnWidths(d) - this.textPadding - 2; // minus borders

					if(cell_data !== undefined && cell_data.length > 0){

						this.ctx.textAlign = 'left';

						var fitted_cell_data = this.fittingStringFast(cell_data, cellMaxWidth);
						this.ctx.fillText(fitted_cell_data, currentX + firstCellWidthOffset + this.textPadding + this.sidebarSize[0], currentY + firstCellHeightOffset + centeringOffset + this.sidebarSize[1]);
					}


					// for the first row, render the column headers
					if (i == startRow) {
						this.ctx.textAlign = 'center';

						var centerOffset = this.columnWidths(d)/2;
						var centeringOffset = ((this.sidebarSize[1] + 2 - this.fontHeight)/2) + 1;
					
						this.ctx.fillText(this.indexToLetters(d+1), currentX + firstCellWidthOffset + this.sidebarSize[0] + centerOffset, centeringOffset);
					}

					currentX += this.columnWidths(d);
					
					
				}

				this.ctx.textAlign = 'center';
				var centerOffset = this.sidebarSize[0]/2;
				var centeringOffset = ((this.rowHeights(i) + 2 - (this.fontHeight-3))/2) + 1;
				this.ctx.font = "9px Arial";
				this.ctx.fillText(i+1, firstCellWidthOffset + centerOffset, currentY + firstCellHeightOffset + this.sidebarSize[1] + centeringOffset);
				this.ctx.font = this.fontStyle;

				currentY += this.rowHeights(i);

				// reset currentX for next iteration
				currentX = startX;
			}

		}

		this.computeWLetterSize = function(){
			var width = this.computeCellTextSize("W");
			return width;
		}
		this.computeCellTextSize = function(text){
			this.ctx.font = this.fontStyle;
			this.ctx.textAlign = 'left';
			this.ctx.textBaseline = 'top';
			var width = this.ctx.measureText(text).width;
			return width;
		}

		this.cachedWLetterSize = this.computeWLetterSize();

		this.fittingStringFast = function(str, maxWidth){
			if(str.length * this.cachedWLetterSize < maxWidth){
				return str;
			}
			else{
				return fittingString(this.ctx, str, maxWidth);
			}
			// possibly obsolete (definitely inaccurate) optimisation
			// else if(str.length > (maxWidth/this.cachedWLetterSize) * 2 ){
			// 	return str.substring(0, maxWidth/this.cachedWLetterSize) + "...";
			// }
		}
	}

	function fittingString(c, str, maxWidth) {
		var width = c.measureText(str).width;
		if(width < maxWidth){
			return str;
		}else{
			var ellipsis = '…';
			var ellipsisWidth = c.measureText(ellipsis).width;
			var len = 1;
			var newString = str;
			var width = 0;

			while (width<=maxWidth-ellipsisWidth && len < str.length) {
				newString = str.substring(0, len);
				width = c.measureText(newString).width;
				len++;
			}

			len -= 2;
			newString = str.substring(0, len);

			return newString+ellipsis;
		}
	}


	var determineFontHeight = function(fontStyle) {
		var body = document.getElementsByTagName("body")[0];
		var dummy = document.createElement("div");
		var dummyText = document.createTextNode("M");
		dummy.appendChild(dummyText);
		dummy.setAttribute("style", fontStyle);
		body.appendChild(dummy);
		var result = dummy.offsetHeight;
		body.removeChild(dummy);
		return result;
	};

	var measureTextDOM = function (text, font) {
		var w, h, div = document.createElement('div');
		div.style.font = font;
		div.style.padding = '0';
		div.style.margin = '0';
		div.style.position = 'absolute';
		div.style.visibility = 'hidden';
		div.innerHTML = text;
		document.body.appendChild(div);
		w = div.clientWidth;
		h = div.clientHeight;
		document.body.removeChild(div);
		return {width: w, height: h};
	}

	var app = new App();
	app.init();
	window.app = app;

})();