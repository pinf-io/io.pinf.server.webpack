
const PATH = require("path");
const EXPRESS = require("express");
const SEND = require("send");
const HTTP = require("http");
const WEBPACK = require("webpack");
const WAITFOR = require("waitfor");


require('org.pinf.genesis.lib').forModule(require, module, function (API, exports) {


	function setupPackSet (app, packSetName, locator, callback) {

		var location = locator.location;

		if (!/^\//.test(location)) {
			location = PATH.dirname(require.resolve(location + "/package.json"));
		}

		function loadPackageConfig (callback) {
			return API.PACKAGE.fromFile(PATH.join(location, "package.json"), function (err, descriptor) {
				if (err) return callback(err);
				return callback(null, descriptor.configForLocator(API.LOCATOR.fromConfigId("io.pinf.server.webpack/0")));
			});
		}

		return loadPackageConfig(function (err, packSetConfig) {
			if (err) return callback(err);

			function configurePack (subName, config) {

				var outputPath = PATH.join(location, config.targetPath);

				var compilerConfig = {
					debug: true,
					bail: true,
					resolveLoader: {
						root: PATH.join(__dirname, "node_modules")
					},					
					context: location,
					module: {
						loaders: [
							{
								test: /\.css$/,
								loader: "style-loader!css-loader",
								include: PATH.join(location, config.sourcePath)
							},
							{
								test: /\.png$/,
								loader: "url-loader?limit=100000",
								include: PATH.join(location, config.sourcePath)
							},
							{
								test: /\.jpg$/,
								loader: "file-loader",
								include: PATH.join(location, config.sourcePath)
							}
						]
					},
					plugins: [
						new WEBPACK.NoErrorsPlugin()
					],
				    externals: {},
				    resolve: {
				        extensions: [
				        	'',
				        	'.js',
				        	'.css'
				        ]
				    },
					entry: {
						app: [
							PATH.dirname(require.resolve("webpack/package.json")) + '/hot/only-dev-server',
							config.sourcePath + '/index.js',
							config.sourcePath + '/index.css'
						]
					},
					output: {
						path: outputPath,
						publicPath: "/" + packSetName + "/" + subName + "/",
						filename: 'bundle.js'
					}
				};

				config.ecosystems.forEach(function (ecosystem) {
					if (ecosystem === "react") {

						compilerConfig.module.loaders.push({
							test: /\.jsx?$/,
							loaders: [
								PATH.dirname(require.resolve('react-hot-loader/package.json')),
								PATH.dirname(require.resolve('jsx-loader/package.json')) + '?insertPragma=React.DOM&harmony'
							],
							include: PATH.join(location, config.sourcePath)
						});

						compilerConfig.plugins.unshift(new WEBPACK.HotModuleReplacementPlugin());

						compilerConfig.externals = {
					        //don't bundle the 'react' npm package with our bundle.js
					        //but get it from a global 'React' variable
					        'react': 'React'
					    };

					    compilerConfig.resolve.extensions.push('.jsx');
					    compilerConfig.entry.app.push(config.sourcePath + '/index.jsx');

					} else {
						throw new Error("Ecosystem '" + ecosystem + "' not supported!");
					}
				});

				API.console.verbose("Setup compiler and route '" + ("/" + packSetName + "/" + subName) + "' for pack from: " + location);

				API.console.debug("compilerConfig", compilerConfig);

				var compiler = WEBPACK(compilerConfig);

				compiler.watch({
				    aggregateTimeout: 300,
				    poll: true
				}, function(err, stats) {
					if (err) {
						console.error("Error compiling bundle!", err.stack);
						return;
					}

// TODO: Notify client of change!

					if (stats.hasErrors()) {
						console.log("WARNING: Stats had errors!");
					}
					if (stats.hasWarnings()) {
						console.log("WARNING: Stats had warnings!");
					}
					console.log(stats.toString({
						colors: true
					}));
				});


				app.get(new RegExp("^\\/" + packSetName + "\\/" + subName + "\\/(.*)$"), function (req, res, next) {
					var path = req.params[0];
					return SEND(req, path, {
						root: outputPath
					}).on("error", next).pipe(res);
				});
			}

			Object.keys(packSetConfig.packs).forEach(function (name) {
				configurePack(name, packSetConfig.packs[name]);
			});

			if (packSetConfig.static) {
				var staticRoutes = Object.keys(packSetConfig.static);
				staticRoutes.sort(function(a, b) {
					return b.length - a.length; // ASC -> a - b; DESC -> b - a
				});
				staticRoutes.forEach(function (route) {
					app.get(new RegExp("^\\/" + packSetName + route.replace(/\/$/, "").replace(/\//g, "\\/") + "(\\/.*)$"), function (req, res, next) {
						var path = req.params[0];
						if (path === "/") path = "/index.html";
						return SEND(req, path, {
							root: PATH.join(location, packSetConfig.static[route])
						}).on("error", next).pipe(res);
					});
				});
			}

			return callback(null);
		});
	}

	return API.Q.denodeify(function (callback) {

		var app = EXPRESS();

		var waitfor = WAITFOR.parallel(function (err) {

			HTTP.createServer(app).listen(API.config.port, API.config.bind);

			console.log("Server listening at: http://" + API.config.bind + ":" + API.config.port);

			return callback(null);
		});

		if (API.config.packs) {
			Object.keys(API.config.packs).forEach(function (name) {
				waitfor(app, name, API.config.packs[name], setupPackSet);
			});
		} else {
			console.log("No 'packs' declared in config.");
		}

		return waitfor();
	})();

});
