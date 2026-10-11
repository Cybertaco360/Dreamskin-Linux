#!/usr/bin/env python3
"""PyQt theme manager. Theme input is data; only the packaged CLI is executed."""
import json
import math
import os
from pathlib import Path
import re
import shutil
import stat
import sys

try:
    from PyQt6 import QtCore as C, QtGui as G, QtWidgets as W
    QT_BINDING = 'PyQt6'
except ImportError:
    try:
        from PyQt5 import QtCore as C, QtGui as G, QtWidgets as W
        QT_BINDING = 'PyQt5'
    except ImportError:
        sys.exit('Install PyQt6 or PyQt5 for this Python interpreter. See DISTROS.md.')

ROOT = Path(__file__).resolve().parent
CLI = str(ROOT / 'dreamskin.mjs')
NODE = os.environ.get('DREAMSKIN_NODE', 'node')


def enum(owner, group, name):
    return getattr(getattr(owner, group, owner), name)


PLAIN = enum(C.Qt, 'TextFormat', 'PlainText')
USER = enum(C.Qt, 'ItemDataRole', 'UserRole')


def label(text='', name=None):
    widget = W.QLabel(text)
    widget.setTextFormat(PLAIN)
    if name:
        widget.setObjectName(name)
    return widget


def data_root():
    override = os.environ.get('DREAMSKIN_DATA_HOME')
    root = Path(override) if override else Path(os.environ.get('XDG_DATA_HOME', str(Path.home() / '.local/share'))) / 'dreamskin-linux'
    if not root.is_absolute():
        raise ValueError('Theme data directory must be absolute.')
    return root


def bounded_file(directory, filename, limit):
    """Read a regular file relative to an already opened, non-symlink directory."""
    if not isinstance(filename, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', filename):
        raise ValueError('Unsafe preview filename')
    fd = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    with os.fdopen(fd, 'rb') as stream:
        metadata = os.fstat(stream.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > limit:
            raise ValueError('Preview file exceeds its limit')
        result = stream.read(limit + 1)
        if len(result) > limit:
            raise ValueError('Preview file exceeds its limit')
        return result


def preview_data(key):
    """Bounded local preview, independent of the authoritative import/apply checks."""
    if not isinstance(key, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*-[0-9a-f]{20}', key):
        raise ValueError('Invalid theme identity')
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    descriptors = []
    try:
        directory = os.open(data_root(), flags)
        descriptors.append(directory)
        directory = os.open('themes', flags, dir_fd=directory)
        descriptors.append(directory)
        directory = os.open(key, flags, dir_fd=directory)
        descriptors.append(directory)
        theme = json.loads(bounded_file(directory, 'theme.json', 1024 * 1024))
        if not isinstance(theme, dict):
            raise ValueError('Invalid theme metadata')
        picture = G.QImage()
        if theme.get('image'):
            image_bytes = bounded_file(directory, theme['image'], 10 * 1024 * 1024)
            buffer = C.QBuffer()
            buffer.setData(image_bytes)
            buffer.open(enum(C.QIODevice, 'OpenModeFlag', 'ReadOnly'))
            reader = G.QImageReader(buffer)
            size = reader.size()
            if size.width() <= 0 or size.height() <= 0 or max(size.width(), size.height()) > 16384 or size.width() * size.height() > 50_000_000:
                raise ValueError('Invalid preview dimensions')
            reader.setScaledSize(size.scaled(C.QSize(1200, 900), enum(C.Qt, 'AspectRatioMode', 'KeepAspectRatio')))
            picture = reader.read()
            if picture.isNull():
                raise ValueError('Image could not be decoded')
        return theme, picture
    finally:
        for fd in reversed(descriptors):
            os.close(fd)


def theme_color(value, fallback):
    # CSS hex order is RGBA; Qt's eight-digit name parser uses ARGB.
    if isinstance(value, str) and re.fullmatch(r'#[0-9a-fA-F]{3,4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}', value):
        digits = value[1:]
        if len(digits) in (3, 4):
            digits = ''.join(char * 2 for char in digits)
        channels = [int(digits[index:index + 2], 16) for index in range(0, len(digits), 2)]
        return G.QColor(*channels)
    return G.QColor(fallback)


class Preview(W.QWidget):
    """Illustrative chat layout; never renders or executes the theme's CSS."""
    def __init__(self):
        super().__init__()
        self.setMinimumSize(360, 250)
        self.setSizePolicy(W.QSizePolicy.Policy.Expanding if hasattr(W.QSizePolicy, 'Policy') else W.QSizePolicy.Expanding,
                           W.QSizePolicy.Policy.Expanding if hasattr(W.QSizePolicy, 'Policy') else W.QSizePolicy.Expanding)
        self.theme = {}
        self.picture = G.QImage()
        self.setAccessibleName('Illustrative theme preview')

    def paintEvent(self, event):
        p = G.QPainter(self)
        p.setRenderHint(enum(G.QPainter, 'RenderHint', 'Antialiasing'))
        rect = C.QRectF(self.rect()).adjusted(1, 1, -1, -1)
        clip = G.QPainterPath()
        clip.addRoundedRect(rect, 16, 16)
        p.setClipPath(clip)
        colors = self.theme.get('colors', {})
        if not isinstance(colors, dict):
            colors = {}
        bg = theme_color(colors.get('background'), '#171a25')
        accent = theme_color(colors.get('accent'), '#9383ee')
        text = theme_color(colors.get('text'), '#f2efff')
        p.fillRect(rect, bg)
        if not self.picture.isNull():
            scale = max(rect.width() / self.picture.width(), rect.height() / self.picture.height())
            width, height = self.picture.width() * scale, self.picture.height() * scale
            art = self.theme.get('art', {})
            def focus(name):
                value = art.get(name, .5) if isinstance(art, dict) else .5
                return min(1, max(0, value)) if isinstance(value, (int, float)) and math.isfinite(value) else .5
            p.drawImage(C.QRectF(rect.x() - (width - rect.width()) * focus('focusX'), rect.y() - (height - rect.height()) * focus('focusY'), width, height), self.picture)
            p.fillRect(rect, G.QColor(8, 10, 20, 85))
        else:
            gradient = G.QLinearGradient(rect.topLeft(), rect.bottomRight())
            gradient.setColorAt(0, bg)
            gradient.setColorAt(1, theme_color(colors.get('accent'), '#35305c').darker(170))
            p.fillRect(rect, gradient)
        p.fillRect(C.QRectF(0, 0, 77, rect.height() + 2), G.QColor(12, 14, 23, 155))
        p.setPen(enum(C.Qt, 'PenStyle', 'NoPen'))
        p.setBrush(accent)
        p.drawRoundedRect(C.QRectF(22, 23, 32, 32), 10, 10)
        p.setBrush(G.QColor(255, 255, 255, 45))
        for y, width in [(85, 34), (107, 28), (129, 34), (177, 30)]:
            p.drawRoundedRect(C.QRectF(23, y, width, 5), 2, 2)
        center = 77 + (rect.width() - 77) / 2
        p.setPen(text)
        font = G.QFont(self.font())
        font.setPointSize(19)
        font.setWeight(enum(G.QFont, 'Weight', 'DemiBold'))
        p.setFont(font)
        p.drawText(C.QRectF(88, rect.height() * .31, rect.width() - 100, 54), enum(C.Qt, 'AlignmentFlag', 'AlignCenter'), 'Make it your space.')
        font.setPointSize(10)
        font.setWeight(enum(G.QFont, 'Weight', 'Normal'))
        p.setFont(font)
        p.drawText(C.QRectF(90, rect.height() * .31 + 56, rect.width() - 104, 24), enum(C.Qt, 'AlignmentFlag', 'AlignCenter'), 'A little more you. A little less default.')
        composer = C.QRectF(center - (rect.width() - 124) / 2, rect.height() - 91, rect.width() - 124, 62)
        p.setPen(G.QPen(G.QColor(255, 255, 255, 65), 1))
        p.setBrush(G.QColor(17, 19, 28, 195))
        p.drawRoundedRect(composer, 13, 13)
        p.setPen(G.QColor('#e1deee'))
        p.drawText(composer.adjusted(16, 0, -45, 0), enum(C.Qt, 'AlignmentFlag', 'AlignVCenter'), 'Ask anything…')
        p.setBrush(accent)
        p.setPen(enum(C.Qt, 'PenStyle', 'NoPen'))
        p.drawEllipse(C.QRectF(composer.right() - 38, composer.top() + 17, 28, 28))
        p.end()


STYLE = '''
QWidget { color: #eeeef7; font-size: 13px; }
QMainWindow, QDialog { background: #11131c; }
QLabel#title { font-size: 27px; font-weight: 700; letter-spacing: -1px; }
QLabel#subtitle, QLabel#muted { color: #9298ad; }
QLabel#heading { font-size: 19px; font-weight: 600; }
QLabel#eyebrow { color: #a8a4c2; font-size: 11px; font-weight: 600; }
QLabel#badge { background: #252a38; border-radius: 10px; padding: 5px 12px; color: #c4c9d8; }
QFrame#panel { background: #1a1d29; border: 1px solid #2a2e40; border-radius: 18px; }
QPushButton, QToolButton { background: #252938; border: 1px solid #353a50; border-radius: 10px; padding: 10px 16px; font-weight: 600; }
QPushButton:hover, QToolButton:hover { background: #30354a; border-color: #6c608f; }
QPushButton:focus, QToolButton:focus { border: 2px solid #baa9ff; }
QPushButton:disabled, QToolButton:disabled { color: #757b91; background: #222635; border-color: #303449; }
QPushButton#primary { color: #161123; background: #b6a2ff; border-color: #b6a2ff; }
QPushButton#primary:hover { background: #c4b5ff; }
QPushButton#primary:disabled { color: #827799; background: #3b344f; border-color: #3b344f; }
QListWidget { background: transparent; border: none; outline: none; }
QListWidget::item { padding: 16px 12px; margin: 3px 0; border: 1px solid transparent; border-radius: 11px; color: #aeb4c9; }
QListWidget::item:selected { background: #302a48; color: #f6f1ff; border-color: #66558c; }
QListWidget::item:hover { background: #252839; }
QScrollBar:vertical { background: transparent; width: 8px; }
QScrollBar::handle:vertical { background: #41465e; border-radius: 4px; min-height: 25px; }
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0; }
QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical { background: transparent; }
QMenu { background: #222635; border: 1px solid #41465e; padding: 6px; }
QMenu::item { padding: 9px 20px; border-radius: 5px; }
QMenu::item:selected { background: #3c3457; }
QLineEdit, QSpinBox, QPlainTextEdit { background: #1b1f2e; border: 1px solid #41465e; border-radius: 7px; padding: 7px; selection-background-color: #69528f; }
QProgressBar { border: none; background: #222635; height: 3px; }
QProgressBar::chunk { background: #b6a2ff; }
QToolTip { background: #252938; color: #eeeef7; border: 1px solid #41465e; padding: 6px; }
'''


class Manager(W.QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle('DreamSkin Linux')
        self.resize(1010, 680)
        self.setMinimumSize(820, 570)
        self.setAcceptDrops(True)
        families = G.QFontDatabase.families() if QT_BINDING == 'PyQt6' else G.QFontDatabase().families()
        family = next((name for name in ('Inter', 'Noto Sans', 'Adwaita Sans', 'DejaVu Sans') if name in families), 'Sans Serif')
        self.setFont(G.QFont(family, 10))
        self.themes = []
        self.session = {'mode': 'idle', 'port': None}
        self.busy = False
        self.process = None
        self.restore_pending = '--restore' in sys.argv
        self.imported_key = None
        self.setStyleSheet(STYLE.replace('QWidget { color:', f'QWidget {{ font-family: "{family}"; color:'))
        root = W.QWidget()
        self.setCentralWidget(root)
        layout = W.QVBoxLayout(root)
        layout.setContentsMargins(30, 26, 30, 20)
        layout.setSpacing(20)
        header = W.QHBoxLayout()
        titles = W.QVBoxLayout()
        titles.setSpacing(5)
        titles.addWidget(label('DreamSkin', 'title'))
        titles.addWidget(label('Your app. Your atmosphere.', 'subtitle'))
        header.addLayout(titles)
        header.addStretch()
        self.import_button = W.QPushButton('+  Import theme')
        self.import_button.clicked.connect(self.import_zip)
        self.import_button.setShortcut('Ctrl+O')
        self.import_button.setToolTip('Import a DreamSkin ZIP (Ctrl+O)')
        header.addWidget(self.import_button)
        self.more = W.QToolButton()
        self.more.setText('•••')
        self.more.setAccessibleName('More actions')
        self.more.setPopupMode(enum(W.QToolButton, 'ToolButtonPopupMode', 'InstantPopup'))
        menu = W.QMenu(self.more)
        for text, action in [('Attach by port…', self.attach), ('Verify theme', lambda: self.run(['verify'], self.show_report)), ('System details', lambda: self.run(['doctor'], self.show_report)), ('Refresh', self.refresh)]:
            menu.addAction(text, action)
        self.more.setMenu(menu)
        header.addWidget(self.more)
        layout.addLayout(header)
        content = W.QHBoxLayout()
        content.setSpacing(22)
        library = W.QFrame()
        library.setObjectName('panel')
        library.setFixedWidth(248)
        side = W.QVBoxLayout(library)
        side.setContentsMargins(18, 20, 18, 16)
        self.count = label('YOUR THEMES', 'eyebrow')
        side.addWidget(self.count)
        self.listbox = W.QListWidget()
        self.listbox.setAccessibleName('Saved themes')
        self.listbox.currentRowChanged.connect(self.select_theme)
        side.addWidget(self.listbox, 1)
        self.empty = label('A fresh start.\n\nImport a theme ZIP to build\nyour collection.', 'muted')
        self.empty.setWordWrap(True)
        side.addWidget(self.empty)
        side.addWidget(label('Stored locally · Yours to switch', 'muted'))
        content.addWidget(library)
        detail = W.QVBoxLayout()
        detail.setSpacing(12)
        top = W.QHBoxLayout()
        self.theme_name = label('Choose your atmosphere', 'heading')
        self.theme_name.setSizePolicy(enum(W.QSizePolicy, 'Policy', 'Ignored'), enum(W.QSizePolicy, 'Policy', 'Preferred'))
        top.addWidget(self.theme_name, 1)
        top.addWidget(label('PREVIEW', 'eyebrow'))
        detail.addLayout(top)
        self.preview = Preview()
        detail.addWidget(self.preview, 1)
        self.theme_info = label('Import a theme to get started.', 'muted')
        detail.addWidget(self.theme_info)
        detail.addWidget(label('Illustrative preview. The app may look different.', 'muted'))
        actions = W.QHBoxLayout()
        self.apply_button = W.QPushButton('Apply theme')
        self.apply_button.setObjectName('primary')
        self.apply_button.setMinimumHeight(44)
        self.apply_button.clicked.connect(self.apply)
        actions.addWidget(self.apply_button, 1)
        self.pause_button = W.QPushButton('Pause')
        self.pause_button.clicked.connect(lambda: self.run(['pause']))
        self.pause_button.setToolTip('Remove the theme and keep the app open')
        actions.addWidget(self.pause_button)
        detail.addLayout(actions)
        content.addLayout(detail, 1)
        layout.addLayout(content, 1)
        connection_panel = W.QFrame()
        connection_panel.setObjectName('panel')
        connection_layout = W.QHBoxLayout(connection_panel)
        connection_layout.setContentsMargins(18, 14, 18, 14)
        self.badge = label('Not connected', 'badge')
        connection_layout.addWidget(self.badge)
        self.connection = label('Connect your app to apply a theme.', 'muted')
        self.connection.setWordWrap(True)
        connection_layout.addWidget(self.connection, 1)
        self.connect_button = W.QPushButton('Connect app')
        self.connect_button.clicked.connect(self.connect_app)
        connection_layout.addWidget(self.connect_button)
        self.restore_button = W.QPushButton('Restore')
        self.restore_button.clicked.connect(self.restore)
        self.restore_button.setToolTip('Remove the theme and close a managed debug app')
        connection_layout.addWidget(self.restore_button)
        layout.addWidget(connection_panel)
        self.message = label('Loading your collection…', 'muted')
        self.message.setWordWrap(True)
        layout.addWidget(self.message)
        self.progress = W.QProgressBar()
        self.progress.setRange(0, 0)
        self.progress.setTextVisible(False)
        self.progress.setFixedHeight(3)
        self.progress.hide()
        layout.addWidget(self.progress)
        self.update_controls()
        C.QTimer.singleShot(0, self.refresh)

    def update_controls(self):
        connected = bool(self.session.get('connected'))
        for button in (self.import_button, self.more, self.connect_button):
            button.setEnabled(not self.busy)
        self.apply_button.setEnabled(not self.busy and connected and self.listbox.currentRow() >= 0)
        self.pause_button.setEnabled(not self.busy and connected and self.session.get('mode') in ('active', 'unconfirmed'))
        self.restore_button.setEnabled(not self.busy and self.session.get('mode') != 'idle')
        self.connect_button.setVisible(not connected)
        self.connect_button.setText('Retry connection' if self.session.get('managed') else 'Connect app')
        self.progress.setVisible(self.busy)

    def run(self, args, callback=None, quiet=False):
        if self.busy:
            return
        self.busy = True
        self.update_controls()
        if not quiet:
            self.message.setText({'import': 'Importing your theme…', 'apply': 'Applying and verifying…', 'launch': 'Opening your app…', 'restore': 'Restoring your app…'}.get(args[0], 'Working…'))
        process = C.QProcess(self)
        self.process = process
        stdout, stderr = bytearray(), bytearray()
        timer = C.QTimer(process)
        timer.setSingleShot(True)
        completed = False

        def finish(error=None):
            nonlocal completed
            if completed:
                return
            completed = True
            timer.stop()
            self.busy = False
            self.process = None
            self.update_controls()
            process.deleteLater()
            if error:
                self.message.setText(error[:700])
                self.message.setStyleSheet('color: #f2a9b5;')
                if args[0] not in ('status', 'list', 'doctor'):
                    self.refresh()
                return
            if not quiet:
                self.message.setStyleSheet('')
            try:
                data = json.loads(bytes(stdout))
                if not isinstance(data, dict):
                    raise ValueError('Invalid response')
            except (ValueError, UnicodeError):
                self.message.setText('The app returned an unreadable result. Open System details for help.')
                return
            if not quiet:
                self.message.setText(data.get('note') or {'import': 'Theme imported. Choose it from your collection.', 'apply': 'Theme applied and verified.', 'pause': 'Theme paused. Your app is still open.', 'restore': 'App restored.', 'attach': 'App connected.'}.get(args[0], 'Done.'))
            if callback:
                callback(data)
            elif args[0] not in ('status', 'list'):
                self.refresh()

        def read_output():
            if completed:
                return
            stdout.extend(bytes(process.readAllStandardOutput()))
            stderr.extend(bytes(process.readAllStandardError()))
            if len(stdout) + len(stderr) > 2 * 1024 * 1024:
                process.kill()
                finish('The command returned too much output. Refresh or Restore before continuing.')

        def exited(code, exit_status):
            if completed:
                return
            read_output()
            if completed:
                return
            error = None
            if code or exit_status == enum(C.QProcess, 'ExitStatus', 'CrashExit'):
                try:
                    error = json.loads(bytes(stdout)).get('error')
                except (ValueError, AttributeError):
                    pass
                error = str(error or bytes(stderr).decode('utf-8', 'replace').strip() or 'Operation failed. Refresh to check the session.')
            finish(error)

        def process_error(error):
            if error == enum(C.QProcess, 'ProcessError', 'FailedToStart'):
                finish('Could not start Node.js. Install Node.js 22+ or check DREAMSKIN_NODE.')

        def timed_out():
            process.kill()
            finish('The command timed out. Refresh to check the session; Restore can recover an interrupted operation.')

        process.readyReadStandardOutput.connect(read_output)
        process.readyReadStandardError.connect(read_output)
        process.finished.connect(exited)
        process.errorOccurred.connect(process_error)
        timer.timeout.connect(timed_out)
        process.start(shutil.which(NODE) or NODE, [CLI, *args, '--json'])
        timer.start(100_000)

    def refresh(self):
        def after_status(data):
            self.session = data
            mode = data.get('mode', 'idle')
            self.badge.setText({'idle': 'Not connected', 'active': 'Theme active', 'paused': 'Connected', 'unconfirmed': 'Needs attention'}.get(mode, 'Needs attention'))
            profile = 'Usual app profile' if data.get('profileMode') == 'original' else 'Separate profile'
            self.connection.setText(('Managed app · ' + profile if data.get('managed') else 'Connected app') if data.get('connected') else 'Connect your app to apply a theme.')
            if mode == 'active' and data.get('theme'):
                self.connection.setText('Using ' + str(data['theme']))
            if mode == 'unconfirmed':
                self.connection.setText('Retry connection, or Restore before launching again.')
            self.run(['list'], after_list, quiet=True)

        def after_list(data):
            old = self.selected_theme()
            self.themes = data.get('themes', [])
            self.listbox.blockSignals(True)
            self.listbox.clear()
            selected = 0
            for index, theme in enumerate(self.themes):
                item = W.QListWidgetItem(f"{theme.get('name', 'Theme')}\n{theme.get('version') or 'Local theme'}")
                item.setData(USER, theme['key'])
                self.listbox.addItem(item)
                if old and not self.imported_key and theme['key'] == old['key']:
                    selected = index
                if theme['key'] == self.imported_key:
                    selected = index
            self.empty.setVisible(not self.themes)
            self.listbox.setVisible(bool(self.themes))
            self.count.setText(f'YOUR THEMES  ·  {len(self.themes)}')
            self.listbox.setCurrentRow(selected if self.themes else -1)
            self.listbox.blockSignals(False)
            self.imported_key = None
            self.select_theme(self.listbox.currentRow())
            if self.message.text() == 'Loading your collection…':
                self.message.setText('Choose a theme, connect your app, and make it yours.' if self.themes else 'Import a DreamSkin ZIP to begin.')
            if self.restore_pending:
                self.restore_pending = False
                C.QTimer.singleShot(0, self.restore)

        self.run(['status'], after_status, quiet=True)

    def selected_theme(self):
        row = self.listbox.currentRow()
        return self.themes[row] if 0 <= row < len(self.themes) else None

    def select_theme(self, row):
        theme = self.selected_theme()
        self.preview.theme, self.preview.picture = {}, G.QImage()
        self.theme_name.setText(theme.get('name', 'Theme') if theme else 'Choose your atmosphere')
        info = f"Version {theme.get('version') or 'local'} · Stored on this device" if theme else 'Import a theme to get started.'
        if theme:
            try:
                self.preview.theme, self.preview.picture = preview_data(theme['key'])
            except (OSError, ValueError, TypeError, OverflowError):
                info += ' · Preview unavailable'
        self.theme_info.setText(info)
        self.preview.update()
        self.update_controls()

    def import_zip(self):
        filename, _ = W.QFileDialog.getOpenFileName(self, 'Import DreamSkin theme', '', 'Theme ZIP (*.zip)')
        if filename:
            self.import_path(filename)

    def import_path(self, filename):
        def imported(data):
            self.imported_key = data.get('key')
            self.refresh()
        self.run(['import', filename], imported)

    def apply(self):
        theme = self.selected_theme()
        if theme and self.session.get('connected'):
            self.run(['apply', theme['key']])

    def connect_app(self):
        if self.session.get('managed'):
            self.run(['reconnect'])
        else:
            self.launch()

    def launch(self):
        def choose(data):
            apps = data.get('apps', [])
            dialog = W.QDialog(self)
            dialog.setWindowTitle('Connect your app')
            dialog.setMinimumWidth(440)
            body = W.QVBoxLayout(dialog)
            title = label('Choose how to open your app', 'heading')
            body.addWidget(title)
            original = W.QRadioButton('Use my usual profile')
            separate = W.QRadioButton('Use a separate profile')
            original.setChecked(True)
            body.addWidget(original)
            body.addWidget(separate)
            explanation = label('', 'muted')
            explanation.setWordWrap(True)
            body.addWidget(explanation)
            def explain():
                explanation.setText('Keeps your normal sign-in and history. Save work and quit your usual app first, then open it here. Restore will close this window.' if original.isChecked() else 'Opens an isolated profile. You may need to sign in again. Restore will close this window.')
            original.toggled.connect(explain)
            explain()
            for app in apps:
                button = W.QPushButton('Open ' + app.get('label', 'app'))
                button.setToolTip(app['executable'])
                def open_app(checked=False, app=app):
                    dialog.accept()
                    args = ['launch', '--app', app['executable'], '--profile', 'original' if original.isChecked() else 'separate']
                    for argument in app.get('args', []):
                        args.extend(['--app-arg', argument])
                    self.run(args)
                button.clicked.connect(open_app)
                body.addWidget(button)
            browse = W.QPushButton('Choose executable or AppImage…')
            def browse_app():
                filename, _ = W.QFileDialog.getOpenFileName(dialog, 'Choose ChatGPT / Codex executable or AppImage')
                if filename:
                    dialog.accept()
                    self.run(['launch', '--app', filename, '--profile', 'original' if original.isChecked() else 'separate'])
            browse.clicked.connect(browse_app)
            body.addWidget(browse)
            attach = W.QPushButton('Connect to an existing debug session…')
            attach.clicked.connect(lambda: (dialog.accept(), self.attach()))
            body.addWidget(attach)
            dialog.exec() if hasattr(dialog, 'exec') else dialog.exec_()
        self.run(['doctor'], choose, quiet=True)

    def attach(self):
        port, accepted = W.QInputDialog.getInt(self, 'Connect to an existing app', 'Local debugging port:', 9222, 1024, 65535)
        if accepted:
            self.run(['attach', '--port', str(port)])

    def restore(self):
        if self.busy:
            self.restore_pending = True
            return
        box = W.QMessageBox(self)
        box.setWindowTitle('Restore your app')
        box.setTextFormat(PLAIN)
        box.setText('Remove the theme and finish this session?')
        box.setInformativeText('Save any work first. An app opened by DreamSkin will close. An existing app you connected to will stay open; quit and reopen it normally to close debugging.')
        yes, no = enum(W.QMessageBox, 'StandardButton', 'Yes'), enum(W.QMessageBox, 'StandardButton', 'No')
        box.setStandardButtons(yes | no)
        box.setDefaultButton(no)
        if (box.exec() if hasattr(box, 'exec') else box.exec_()) == yes:
            self.run(['restore'])

    def show_report(self, data):
        dialog = W.QDialog(self)
        dialog.setWindowTitle('DreamSkin details')
        dialog.resize(720, 490)
        body = W.QVBoxLayout(dialog)
        view = W.QPlainTextEdit()
        view.setReadOnly(True)
        view.setPlainText(json.dumps(data, indent=2, ensure_ascii=False))
        body.addWidget(view)
        close = W.QPushButton('Close')
        close.clicked.connect(dialog.accept)
        body.addWidget(close)
        dialog.exec() if hasattr(dialog, 'exec') else dialog.exec_()

    def dragEnterEvent(self, event):
        urls = event.mimeData().urls()
        if not self.busy and len(urls) == 1 and urls[0].isLocalFile() and urls[0].toLocalFile().lower().endswith('.zip'):
            event.acceptProposedAction()

    def dropEvent(self, event):
        urls = event.mimeData().urls()
        if not self.busy and len(urls) == 1 and urls[0].isLocalFile() and urls[0].toLocalFile().lower().endswith('.zip'):
            event.acceptProposedAction()
            self.import_path(urls[0].toLocalFile())

    def closeEvent(self, event):
        if self.busy:
            event.ignore()
            self.message.setText('Please wait for this operation to finish before closing DreamSkin.')
        else:
            event.accept()


def main():
    app = W.QApplication(sys.argv)
    app.setApplicationName('DreamSkin Linux')
    app.setStyle('Fusion')
    palette = app.palette()
    for role, color in [('Window', '#11131c'), ('WindowText', '#eeeef7'), ('Base', '#1b1f2e'), ('Text', '#eeeef7'), ('Button', '#252938'), ('ButtonText', '#eeeef7'), ('Highlight', '#69528f'), ('HighlightedText', '#ffffff')]:
        palette.setColor(enum(G.QPalette, 'ColorRole', role), G.QColor(color))
    app.setPalette(palette)
    window = Manager()
    window.show()
    return app.exec() if hasattr(app, 'exec') else app.exec_()


if __name__ == '__main__':
    sys.exit(main())
