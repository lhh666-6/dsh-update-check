window.__ModuleLoader__.load({
	id: "dsh-update-check-plus",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/UpdateCapsule.tsx
		/**
		* UpdateCapsule: status pill plus a detail panel. Primary surface is the
		* DSH Desktop update channel (real installers via dshdesktop.cn); secondary
		* is the GitHub source channel. State comes from the host route
		* (/dsh-update-check-plus/state.json); when unreachable it falls back to a direct
		* GitHub query so latest-version info still shows.
		*/
		const STATE_ROUTE = "/dsh-update-check-plus/state.json";
		const CHECK_ACTION = "/dsh-update-check-plus/actions/check";
		const DOWNLOAD_ACTION = "/dsh-update-check-plus/actions/download";
		const DESKTOP_UPDATE_ACTION = "/dsh-update-check-plus/actions/desktop-update";
		const UPGRADE_ACTION = "/dsh-update-check-plus/actions/upgrade";
		const OFFICIAL_PAGE = "https://www.dshdesktop.cn/";
		const AMBER = "var(--dsw-alias-state-warn-primary)";
		const GREEN = "var(--dsw-alias-state-success-primary)";
		const RED = "var(--dsw-alias-state-error-primary)";
		const GRAY = "var(--dsw-alias-label-tertiary)";
		const capsuleStyle = {
			display: "inline-flex",
			alignItems: "center",
			gap: 6,
			padding: "3px 10px",
			borderRadius: 999,
			border: "1px solid var(--dsw-alias-border-l3)",
			background: "var(--dsw-alias-bg-overlay)",
			color: "var(--dsw-alias-label-secondary)",
			font: "inherit",
			fontSize: 12,
			lineHeight: 1.3,
			cursor: "pointer",
			whiteSpace: "nowrap",
			userSelect: "none"
		};
		const panelStyle = {
			position: "fixed",
			left: 0,
			right: 0,
			bottom: 0,
			margin: "0 auto",
			maxWidth: 640,
			boxSizing: "border-box",
			zIndex: 1e3,
			width: "auto",
			padding: 14,
			borderRadius: "12px 12px 0 0",
			border: "1px solid var(--dsw-alias-border-l3)",
			borderBottom: "none",
			background: "var(--dsw-specific-menu)",
			color: "var(--dsw-alias-label-primary)",
			boxShadow: "0 -8px 24px var(--dsw-alias-bg-mask-1)",
			fontSize: 12.5,
			lineHeight: 1.5,
			maxHeight: "70vh",
			overflowY: "auto"
		};
		const rowStyle = {
			display: "flex",
			justifyContent: "space-between",
			gap: 12,
			padding: "2px 0"
		};
		const labelStyle = { color: "var(--dsw-alias-label-secondary)" };
		const valueStyle = {
			fontVariantNumeric: "tabular-nums",
			color: "var(--dsw-alias-label-primary)"
		};
		const mutedStyle = {
			color: "var(--dsw-alias-label-tertiary)",
			padding: "2px 0"
		};
		const notesStyle = {
			margin: "6px 0 0",
			maxHeight: 150,
			overflowY: "auto",
			whiteSpace: "pre-wrap",
			wordBreak: "break-word",
			fontSize: 11.5,
			color: "var(--dsw-alias-label-secondary)",
			borderTop: "1px solid var(--dsw-alias-border-l2)",
			paddingTop: 8
		};
		const btnRowStyle = {
			display: "flex",
			gap: 8,
			marginTop: 10,
			flexWrap: "wrap"
		};
		const btnStyle = {
			padding: "4px 10px",
			borderRadius: 8,
			border: "1px solid var(--dsw-alias-border-l3)",
			background: "var(--dsw-alias-bg-overlay)",
			color: "var(--dsw-alias-label-primary)",
			cursor: "pointer",
			fontSize: 12
		};
		const primaryBtnStyle = {
			...btnStyle,
			background: "var(--dsw-alias-state-warn-primary)",
			borderColor: "var(--dsw-alias-state-warn-primary)",
			color: "#fff",
			fontWeight: 600
		};
		const sectionTitleStyle = {
			margin: "8px 0 4px",
			fontSize: 11,
			letterSpacing: "0.06em",
			textTransform: "uppercase",
			color: "var(--dsw-alias-label-caption)"
		};
		const progressTrack = {
			height: 6,
			borderRadius: 3,
			background: "var(--dsw-alias-border-l2)",
			overflow: "hidden",
			margin: "4px 0"
		};
		const progressFill = {
			height: "100%",
			background: AMBER,
			transition: "width 0.3s"
		};
		async function fetchJson(url, timeoutMs = 8e3, method = "GET") {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeoutMs);
			try {
				const res = await fetch(url, {
					method,
					signal: controller.signal,
					headers: { Accept: "application/json" }
				});
				if (!res.ok) {
					let detail = "";
					try {
						detail = String((await res.json())?.error ?? "");
					} catch {}
					throw new Error("HTTP " + res.status + (detail.length > 0 ? ": " + detail : ""));
				}
				return await res.json();
			} finally {
				clearTimeout(timer);
			}
		}
		function Row({ label, value, valueColor }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: rowStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: labelStyle,
					children: label
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: valueColor !== void 0 ? {
						...valueStyle,
						color: valueColor
					} : valueStyle,
					children: value
				})]
			});
		}
		function UpdateCapsule(props) {
			const { wide } = props;
			const [state, setState] = (0, react.useState)(null);
			const [open, setOpen] = (0, react.useState)(false);
			const [busy, setBusy] = (0, react.useState)(false);
			const [actionError, setActionError] = (0, react.useState)(null);
			const [upgrading, setUpgrading] = (0, react.useState)(false);
			const refresh = (0, react.useCallback)(async () => {
				try {
					const host = await fetchJson(STATE_ROUTE);
					setState(host);
					return;
				} catch {}
				try {
					const first = (await (await fetch("https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=1", { headers: { Accept: "application/json" } })).json())[0];
					setState({
						currentVersion: null,
						latestTag: first?.tag_name ?? null,
						latestName: first?.name ?? "",
						latestPublishedAt: first?.published_at ?? null,
						latestBody: (first?.body ?? "").slice(0, 2e3),
						latestUrl: first?.html_url ?? null,
						updateAvailable: false,
						lastCheckedAt: null,
						lastError: null,
						downloads: [],
						desktopVersion: null,
						desktopUpdateAvailable: false,
						desktopLastCheckedAt: null,
						desktopError: null,
						desktopDownload: {
							version: null,
							status: "idle",
							received: 0,
							total: 0,
							path: null,
							error: null
						}
					});
				} catch {
					setState(null);
				}
			}, []);
			(0, react.useEffect)(() => {
				refresh();
				const timer = setInterval(() => {
					refresh();
				}, 1e4);
				return () => clearInterval(timer);
			}, [refresh]);
			if (state === null) return null;
			const dd = state.desktopDownload;
			const desktopUpdating = dd.status === "downloading" || dd.status === "installing";
			const hasDesktopUpdate = state.desktopUpdateAvailable || desktopUpdating || dd.status === "error" || dd.status === "downloaded";
			const checking = state.lastCheckedAt === null;
			const capsuleColor = checking ? GRAY : state.desktopUpdateAvailable ? AMBER : desktopUpdating ? AMBER : state.updateAvailable ? AMBER : GREEN;
			const label = desktopUpdating ? "⏳ 更新 " + (dd.version ?? "") : state.desktopUpdateAvailable ? "⬆ " + state.desktopVersion : state.updateAvailable ? "⬆ " + state.latestTag : state.currentVersion !== null ? "✓ " + state.currentVersion : checking ? "检查中…" : "dsh";
			const trigger = async (action, timeoutMs = 8e3) => {
				setBusy(true);
				setActionError(null);
				try {
					await fetchJson(action, timeoutMs, "POST");
					await refresh();
				} catch (err) {
					setActionError(err instanceof Error ? err.message : String(err));
					await refresh();
				} finally {
					setBusy(false);
				}
			};
			const doUpgrade = async () => {
				setBusy(true);
				setActionError(null);
				try {
					await fetchJson(UPGRADE_ACTION, 6e5, "POST");
					setUpgrading(true);
				} catch (err) {
					setActionError(err instanceof Error ? err.message : String(err));
				} finally {
					setBusy(false);
				}
			};
			const pct = dd.total > 0 ? Math.min(100, Math.round(dd.received / dd.total * 100)) : 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: { position: "relative" },
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					style: {
						...capsuleStyle,
						color: capsuleColor
					},
					onClick: () => setOpen(!open),
					title: "DSH 更新检查",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
						width: 6,
						height: 6,
						borderRadius: 999,
						background: capsuleColor,
						display: "inline-block"
					} }), wide === false ? null : label]
				}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: panelStyle,
					children: [
						hasDesktopUpdate && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: sectionTitleStyle,
								children: "桌面端更新"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
								label: "当前版本",
								value: state.currentVersion ?? "未知"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
								label: "最新版本",
								value: state.desktopVersion ?? "—",
								valueColor: state.desktopUpdateAvailable ? AMBER : void 0
							}),
							dd.status === "downloading" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: progressTrack,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { style: {
									...progressFill,
									width: pct + "%"
								} })
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: mutedStyle,
								children: ["下载中 ", dd.total > 0 ? (dd.received / 1048576).toFixed(1) + " / " + (dd.total / 1048576).toFixed(1) + " MB" : "…"]
							})] }),
							dd.status === "installing" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: mutedStyle,
								children: "安装器已启动，应用即将重启完成安装…"
							}),
							dd.status === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									...mutedStyle,
									color: RED
								},
								children: ["下载失败：", dd.error]
							}),
							state.desktopUpdateAvailable && dd.status !== "downloading" && dd.status !== "installing" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: btnRowStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: primaryBtnStyle,
									disabled: busy,
									onClick: () => {
										trigger(DESKTOP_UPDATE_ACTION, 15e3);
									},
									children: busy ? "启动中…" : "下载并更新（约 160MB）"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: btnStyle,
									onClick: () => {
										window.open(OFFICIAL_PAGE, "_blank");
									},
									children: "官网"
								})]
							}),
							state.desktopUpdateAvailable && dd.status === "downloaded" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: mutedStyle,
								children: ["安装器已就绪：", dd.path]
							}),
							!state.desktopUpdateAvailable && dd.status !== "error" && dd.status !== "installing" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: mutedStyle,
								children: "桌面端已是最新版本。"
							})
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: sectionTitleStyle,
							children: "源码更新（GitHub）"
						}),
						state.updateAvailable && state.latestTag !== null && !upgrading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: btnRowStyle,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: primaryBtnStyle,
								disabled: busy,
								onClick: () => {
									doUpgrade();
								},
								children: busy ? "准备中…" : "一键更新到 " + state.latestTag + "（自动重启）"
							})
						}),
						upgrading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								...mutedStyle,
								color: AMBER
							},
							children: "升级已启动：应用将在几秒后自动关闭并重启，请稍候…（引擎将替换为最新版）"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
							label: "最新 tag",
							value: state.latestTag ?? "—"
						}),
						state.latestPublishedAt !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
							label: "发布时间",
							value: state.latestPublishedAt.slice(0, 10)
						}),
						state.lastCheckedAt !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
							label: "上次检查",
							value: state.lastCheckedAt.slice(0, 16).replace("T", " ")
						}),
						state.lastError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: mutedStyle,
							children: ["检查异常：", state.lastError]
						}),
						state.downloads.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: mutedStyle,
							children: [
								"已下载源码：",
								state.downloads[state.downloads.length - 1].tag,
								"（",
								(state.downloads[state.downloads.length - 1].bytes / 1048576).toFixed(1),
								" MB）"
							]
						}),
						state.latestBody !== null && state.latestBody.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: notesStyle,
							children: state.latestBody.slice(0, 600)
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: btnRowStyle,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: btnStyle,
									disabled: busy,
									onClick: () => {
										trigger(CHECK_ACTION);
									},
									children: busy ? "…" : "立即检查"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: btnStyle,
									disabled: busy,
									onClick: () => {
										trigger(DOWNLOAD_ACTION);
									},
									children: "下载源码"
								}),
								state.latestUrl !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: btnStyle,
									onClick: () => {
										window.open(state.latestUrl, "_blank");
									},
									children: "打开 Release"
								})
							]
						}),
						actionError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								...mutedStyle,
								color: RED
							},
							children: ["操作失败：", actionError]
						})
					]
				})]
			});
		}
		//#endregion
		//#region src/client/index.ts
		/** Required services: the sidebar footer-action slot registry only. */
		const inject = ["slots"];
		/**
		* Register the capsule into the sidebar footer action list, immediately to
		* the left of the settings button.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "update-check-plus",
				order: 10
			}, UpdateCapsule));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
