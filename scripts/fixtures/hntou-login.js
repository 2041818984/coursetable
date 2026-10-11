//给登录界面的action加上时间戳
document.forms[0].action = (document.forms[0].action) + "?time=" + new Date().getTime();

var dlArr = [];

function refreshCode() {
    $("#yzmPic").attr("src", _path + '/kaptcha?time=' + new Date().getTime());
}

function setLocal() {
    var local = "zh_CN";
    if ('1' == $("#sfzywqh").val()) {
        local = $(".btn-lang-enabled").val();
    }
    return local;
}

function UserPolicy() {
    $.showDialog(_path + '/xtgl/xwgl_ckYhxy.html', '用户协议', {})
}

function setUserInfo(data) {
    var u = navigator.userAgent;
    var isiOS = !!u.match(/\(i[^;]+;( U;)? CPU.+Mac OS X/); //ios终端
    if (isiOS) {
        window.webkit.messageHandlers.sendUserInfo.postMessage(data);

    } else {
        window.android.sendUserInfo(data);

    }
}


function getUserInfo(jsonStr) {
    if (jsonStr != '') {
        var yhxx = jsonStr.split(',');
        window.location.href = _path + "/auth/auth_loginSuccess.html?yhm=" + yhxx[0] + "&timestamp=" + yhxx[1];
    } else {
        $("body").show();
    }

}

jQuery(function ($) {
    var sUserAgent = navigator.userAgent.toLowerCase();
    if ($("#ydappsfbldlzt").val() == 1 && device.mobile() && sUserAgent.indexOf('zfsoft') > -1) {

    } else {
        $("body").show();
    }
    $(".refresh-text").off("click", "a[id='qrcode_refresh']").on("click", "a[id='qrcode_refresh']", function () {
        $("#qrcode-content").hide();
        $("#qcodediv").click();
    });
    $(".login-header").off("click", "div[id='qcodediv']").on("click", "div[id='qcodediv']", function () {
        $("#home,#qcodediv").hide();
        $("#qcodepc,#qcodcasepcdiv").show();
        $.getJSON(_path + "/bysxxcx/xscjzbdy_getLoginQrCode.html", function (data) {
            sfydl = true;
            $("#qrcode-img img").attr("src", "data:image/png;base64," + data.img);
            $("#uuid").val(data.UUID);
        });

        var erweimatime = 30;
        //二维码刷新计时
        var myVar = setInterval(myTimer, (erweimatime - 10) * 1000);
        //切换到扫码登录后进行轮训，判断用户是否已经登录
        var LoginTimer = setInterval(ztTimer, 5000);

        function myTimer() {
            $("#qrcode-content").show();
            //二维码失效时停止计时器
            clearInterval(myVar);
            clearInterval(LoginTimer);
        }

        function ztTimer() {
            if (!sfydl) {
                //切换到用户登录页签时停止计时器
                clearInterval(myVar);
                clearInterval(LoginTimer);
            } else {
                $.ajax({
                    url: _path + '/auth/auth_cxJwLoginZt.html',
                    async: false,
                    type: "post",
                    data: {uuid: $("#uuid").val()},
                    dataType: "json",
                    success: function (data) {
                        if (data.msg == 'success') {
                            //返回登录状态为成功时停止计时器
                            clearInterval(LoginTimer);
                            window.location.href = _path + data.redirectPath;
                        }
                    }
                });
            }
        }
    });

    $(".login-header").off("click", "div[id='qcodcasepcdiv']").on("click", "div[id='qcodcasepcdiv']", function () {
        sfydl = false;
        $("#home,#qcodediv").show();
        $("#qcodepc,#qcodcasepcdiv").hide();
    });

    refreshCode();
    $('#mm,#yzm').empty();

    $("#mm").bind("copy paste cut", function () {
        return $("#dlmmsfknt").val() == "1" ? true : false;
    });

    //获得焦点
    $("#yhm").focus();
    //设置回车登录事件
    $('#yhm,#mm,#yzm').unbind("keydown").bind("keydown", function (e) {
        var event = $.event.fix(e);
        //回车自动查询
        if (event.keyCode == 13) {
            //取消浏览器默认行为
            event.preventDefault();
            //点击登录
            $('#dl').click();
        }
        //取消事件冒泡
        event.stopPropagation();
        //阻止剩余的事件处理函数执行并且防止事件冒泡到DOM树上
        event.stopImmediatePropagation();
    });


    var modulus, exponent;

    $.getJSON(_path + "/xtgl/login_getPublicKey.html?time=" + new Date().getTime(), function (data) {
        modulus = data["modulus"];
        exponent = data["exponent"];
    });

    $("#dl").click(function () {
        if ($("#userPolicyOn").val() == "1" && $("#agreePolicy").eq(0).is(':checked') == false) {
            $("#tips").empty().append("请先阅读《用户协议》，并勾选已阅读。");
            $("#tips").show();
            return;
        }
        var loginBtn = this;
        //2.让提交按钮失效，以实现防止按钮重复点击
        $(loginBtn).attr('disabled', 'disabled');
        //3.给用户提供友好状态提示
        $(loginBtn).text('登录中...');
        if ($(".btn-lang-enabled").val() == "en_US") {
            $(loginBtn).text("Logining");
        }
        /*var time= sessionStorage.getItem('time');
        var fz=Number($("#fz").val());
        var ms=fz*60000;
        var timestamp = (new Date()).valueOf(); //当前时间戳
        if(time!=null&&time!=""){
            if((parseInt(time)+parseInt(ms))>parseInt(timestamp)){
                var sj=(parseInt(time)+parseInt(ms))-parseInt(timestamp);
                var minutes = parseInt((sj % (1000 * 60 * 60)) / (1000 * 60)*60);
                alert("您已超过最大登录失败次数，请在"+minutes+"秒后再登");
                return;
            }
        }else{
            var dlcount=$("#dlcount").val();
            var yzcskz=$("#yzcskz").val();
            var yh=$("#yh").val();
            var dltime=$("#dltime").val();
            if(dlcount>=yzcskz-1){
                sessionStorage.setItem('user',yh);
                sessionStorage.setItem('time',dltime);
            }
        }*/

        var ts = '<span class="glyphicon glyphicon-minus-sign"></span>';
        if (!$.founded($("#yhm").val())) {
            $("#tips").empty().append(ts + $.i18n.zftal["login"]["user_empty"]);
            $("#tips").show();
            //5.让登陆按钮重新有效
            $(loginBtn).removeAttr('disabled');
            $(loginBtn).text('登录');
            $("#mm").val("");
            return false;
        }
        if (!$.founded($("#mm").val())) {
            ///$("#tips").removeClass("alert-danger").addClass("alert-warning");
            $("#tips").empty().append(ts + $.i18n.zftal["login"]["pwd_empty"]);
            $("#tips").show();
            //5.让登陆按钮重新有效
            $(loginBtn).removeAttr('disabled');
            $(loginBtn).text('登录');
            $("#mm").val("");
            return false;
        }
        if ($("#mmsrddcshkzfs").val() == "0" || $("#dlsfbxyzm").val() == "1") {
            if ($("#yzmDiv:visible").size() > 0) {
                if (!$.founded($("#yzm").val())) {
                    $("#tips").empty().append(ts + $.i18n.zftal["login"]["yzm_empty"]);
                    $("#tips").show();
                    //5.让登陆按钮重新有效
                    $(loginBtn).removeAttr('disabled');
                    $(loginBtn).text('登录');
                    $("#mm").val("");
                    return false;
                }
            }
        }

        if ($("#mmsfjm").val() == '0') {
            $("#hidMm").val($("#mm").val());
        } else {
            var rsaKey = new RSAKey();
            rsaKey.setPublic(b64tohex(modulus), b64tohex(exponent));
            var enPassword = hex2b64(rsaKey.encrypt($("#mm").val()));
            $("#mm").val(enPassword);
            $("#hidMm").val(enPassword);   //页面上放了一个隐藏的password类型输入框，name也是mm，防止密码自动填充，在提交的时候把内容设置成跟输入的密码一致

        }
		var sfxxqr = false;
        $.ajax({
            url: _path + '/xtgl/yhgl_cxXxqrCheck.html',
            async: false,
            type: "post",
            dataType: "json",
            data: {"yhm": $("#yhm").val()},
            success: function (data) {
				sfxxqr = data;
            }
        });
        if (sfxxqr){
            $.showDialog(_path + '/xtgl/yhgl_cxXxqrView.html', '身份信息', {
                width: "500px",
                modalName: "addModal",
                data: {"yhm": $("#yhm").val()},
                buttons: {
                    success: {
                        label: "确 定",
                        className: "btn-primary",
                        callback: function () {
                            if ($("#syr_xxqr").val() == "") {
                                $.alert("请填写使用人!");
                                return false;
                            }
                            if ($("#syyy_xxqr").val() == "") {
                                $.alert("请填写使用原因!");
                                return false;
                            }

                            $.ajax({
                                url: _path + '/xtgl/yhgl_cxXxqrBc.html',
                                async: false,
                                type: "post",
                                dataType: "json",
                                data: {"yhm": $("#yhm_xxqr").val(),"syr": $("#syr_xxqr").val(), "syyy": $("#syyy_xxqr").val()},
                                success: function (msg) {
                                    $.closeModal("addModal");
                                    if ($("#mmsrddcshkzfs").val() == "1") {
                                        var isSuccess = false;
                                        $.ajax({
                                            url: _path + '/xtgl/login_cxDlxgxx.html',
                                            async: false,
                                            type: "post",
                                            dataType: "json",
                                            data: {"yhm": $("#yhm").val()},
                                            success: function (data) {
                                                if (data == "0") {
                                                    //alert("用户不存在");
                                                    if ($(".btn-lang-enabled").val() == "en_US") {
                                                        $("#tips").empty().append(ts + "User does not exist");
                                                        $("#tips").show();
                                                    } else {
                                                        $("#tips").empty().append(ts + "用户不存在");
                                                        $("#tips").show();
                                                    }
                                                    isSuccess = false;
                                                } else {
                                                    var dataArr = data.split("_");
                                                    var yzcskz = $("#yzcskz").val();
                                                    if (dataArr[0] >= yzcskz) {
                                                        var fz = Number($("#dlsbsdsj").val());//设置的锁定时间（分钟)
                                                        var ms = fz * 60000;//转成秒数
                                                        var timestamp = (new Date()).valueOf(); //当前时间戳
                                                        if ((parseInt(dataArr[1]) + parseInt(ms)) > parseInt(timestamp)) {
                                                            var sj = (parseInt(dataArr[1]) + parseInt(ms)) - parseInt(timestamp);
                                                            var minutes = parseInt((sj % (1000 * 60 * 60)) / (1000 * 60) * 60);
                                                            if ($(".btn-lang-enabled").val() == "en_US") {
                                                                $("#tips").empty().append(ts + "You have exceeded the maximum number of login failures. Please sign in after " + minutes + " seconds");
                                                                $("#tips").show();
                                                            } else {
                                                                $("#tips").empty().append(ts + "您已超过最大登录失败次数，请在" + minutes + "秒后再登");
                                                                $("#tips").show();
                                                            }
                                                            //alert("您已超过最大登录失败次数，请在"+minutes+"秒后再登");
                                                            isSuccess = false;
                                                        } else {
                                                            //锁定时间过了就更新登录失败次数为0
                                                            $.ajax({
                                                                url: _path + '/xtgl/login_cxUpdateDlsbcs.html',
                                                                async: false,
                                                                type: "post",
                                                                dataType: "json",
                                                                data: {"yhm": $("#yhm").val()},
                                                                success: function (data) {
                                                                    if (data == "操作成功") {
                                                                        isSuccess = true;
                                                                    }
                                                                }
                                                            })
                                                        }
                                                    } else {
                                                        isSuccess = true;
                                                    }
                                                }
                                            }
                                        });
                                        if (isSuccess) {
                                            yhdl();
                                        }
                                        else {
                                            //5.让登陆按钮重新有效
                                            $(loginBtn).removeAttr('disabled');
                                            $(loginBtn).text('登录');
                                            $("#mm").val("");
                                            return false;
                                        }
                                    }
                                    else {
                                        yhdl();
                                    }
                                }
                            })
                            return false;
                        }
                    },
                    cancel: {
                        label: "关 闭",
                        className: "btn-default",
                        callback: function () {
                            window.location.href = window.location.href;
                        }

                    }
                }
            });
        }else{
            //		var isSuccess = false;
            //		$.ajax({
            //			url		:_path+'/xtgl/login_cxCheckYh.html',
            //			async	: false,
            //			type	:"post",
            //			dataType:"json",
            //			data	:{"yhm":$("#yhm").val(), "mm":$("#mm").val(), "yzm" :$("#yzm").val()},
            //			success	:function(data){
            //				if(data["status"]=="success"){
            //					isSuccess = true;
            //				}else{
            //					//输错三次 则需输验证码
            //					if((data["dlCount"]||0) * 1 >= 3){
            //						$("#yzmDiv").show();
            //						refreshCode();
            //					}
            //					refreshCode();
            //					//提示
            //					$("#tips").empty().append(ts + data["message"]);
            //					$("#tips").show();
            //					isSuccess = false;
            //				}
            //			}
            //		});
            //		if(isSuccess){
            //document.forms[0].submit();
            //		}else{
            //			return false;
            //		}
            if ($("#mmsrddcshkzfs").val() == "1") {
                var isSuccess = false;
                $.ajax({
                    url: _path + '/xtgl/login_cxDlxgxx.html',
                    async: false,
                    type: "post",
                    dataType: "json",
                    data: {"yhm": $("#yhm").val()},
                    success: function (data) {
                        if (data == "0") {
                            //alert("用户不存在");
                            if ($(".btn-lang-enabled").val() == "en_US") {
                                $("#tips").empty().append(ts + "User does not exist");
                                $("#tips").show();
                            } else {
                                $("#tips").empty().append(ts + "用户不存在");
                                $("#tips").show();
                            }
                            isSuccess = false;
                        } else {
                            var dataArr = data.split("_");
                            var yzcskz = $("#yzcskz").val();
                            if (dataArr[0] >= yzcskz) {
                                var fz = Number($("#dlsbsdsj").val());//设置的锁定时间（分钟)
                                var ms = fz * 60000;//转成秒数
                                var timestamp = (new Date()).valueOf(); //当前时间戳
                                if ((parseInt(dataArr[1]) + parseInt(ms)) > parseInt(timestamp)) {
                                    var sj = (parseInt(dataArr[1]) + parseInt(ms)) - parseInt(timestamp);
                                    var minutes = parseInt((sj % (1000 * 60 * 60)) / (1000 * 60) * 60);
                                    if ($(".btn-lang-enabled").val() == "en_US") {
                                        $("#tips").empty().append(ts + "You have exceeded the maximum number of login failures. Please sign in after " + minutes + " seconds");
                                        $("#tips").show();
                                    } else {
                                        $("#tips").empty().append(ts + "您已超过最大登录失败次数，请在" + minutes + "秒后再登");
                                        $("#tips").show();
                                    }
                                    //alert("您已超过最大登录失败次数，请在"+minutes+"秒后再登");
                                    isSuccess = false;
                                } else {
                                    //锁定时间过了就更新登录失败次数为0
                                    $.ajax({
                                        url: _path + '/xtgl/login_cxUpdateDlsbcs.html',
                                        async: false,
                                        type: "post",
                                        dataType: "json",
                                        data: {"yhm": $("#yhm").val()},
                                        success: function (data) {
                                            if (data == "操作成功") {
                                                isSuccess = true;
                                            }
                                        }
                                    })
                                }
                            } else {
                                isSuccess = true;
                            }
                        }
                    }
                });

                if (isSuccess) {
                    yhdl();
                    //登录前退出原先的帐号
//					$.post(_path + "/xtgl/login_logoutAccount.html",{"csrfTokenLogout":$("#csrfTokenLogout").val()},function(){
//						var local = setLocal();
//						$("#language").val(local);
//						document.forms[0].submit();
//					});
                } else {
                    //5.让登陆按钮重新有效
                    $(loginBtn).removeAttr('disabled');
                    $(loginBtn).text('登录');
                    $("#mm").val("");
                    return false;
                }
            } else {
                yhdl();
                //登录前退出原先的帐号
//				$.post(_path + "/xtgl/login_logoutAccount.html",{"csrfTokenLogout":$("#csrfTokenLogout").val()},function(){
//					var local = setLocal();
//					$("#language").val(local);
//					document.forms[0].submit();
//				});
            }
        }

    });

    function yhdl() {
        //登录前退出原先的帐号
        $.post(_path + "/xtgl/login_logoutAccount.html", {"csrfTokenLogout": $("#csrfTokenLogout").val()}, function () {
            var local = setLocal();
            $("#language").val(local);
            //判断是否需要短信验证
            if ($("#dxsyrz").val() == '1') {
                //判断是否存在手机号
                $.post(_path + "/xtgl/login_dxyzCxsjhm.html", {"yhm": $("#yhm").val()}, function (data) {
                    if (data == "1") {//判断是否存在手机号
                        $.showDialog(_path + "/xtgl/login_dxyzIndex.html?gnmkdm=login&yhm=" + $("#yhm").val(), '短信验证', $.extend(true, {}, addConfig, {
                                width: "600px",
                                modalName: "rqyzmModal",
                                buttons: {
                                    success: {
                                        label: "确定",
                                        className: "btn-primary",
                                        callback: function () {
                                            if ($("#dlyzm").val() == "") {
                                                $.alert("请填写验证码!");
                                                return false;
                                            }

                                            $.ajax({
                                                url: _path + '/xtgl/login_dxyzQryzm.html',
                                                async: false,
                                                type: "post",
                                                dataType: "json",
                                                data: {"sjhm": $("#sjhm").val(), "yzm": $("#dlyzm").val()},
                                                success: function (msg) {
                                                    if (msg == "1") {
                                                        $.closeModal("rqyzmModal");
                                                        document.forms[0].submit();
                                                    } else {
                                                        $.alert("验证失败", function () {
                                                            //window.location.href = window.location.href;
                                                        });
                                                    }
                                                }
                                            })
                                            return false;
                                        }
                                    },
                                    cancel: {
                                        label: "关 闭",
                                        className: "btn-default",
                                        callback: function () {
                                            window.location.href = window.location.href;
                                        }
                                    }
                                }
                            }
                        ));
                        return false;
                    } else {
                        $.error("当前用户未预留手机号,无法登录系统!");
                        window.location.href = window.location.href;
                    }
                });
            } else {
                if ($("#ydappsfbldlzt").val() == 1 && device.mobile() && sUserAgent.indexOf('zfsoft') > -1) {
                    $.post(_path + "/auth/auth_yhmMm.html", {"yhm": jQuery("#yhm").val()}, function (data) {
                        setUserInfo(data);
                    });
                    document.forms[0].submit();
                } else {
                    document.forms[0].submit();
                }
            }
        });
    }

    $("#dxyzmdl").click(function () {
        //登录前退出原先的帐号
        $.post(_path + "/xtgl/login_logoutAccount.html", {"csrfTokenLogout": $("#csrfTokenLogout").val()}, function () {
            var local = setLocal();
            $("#language").val(local);

            $.showDialog(_path + "/xtgl/login_dxyzmdlIndex.html?gnmkdm=login", '短信验证码登录', $.extend(true, {}, addConfig, {
                    width: "600px",
                    modalName: "dxyzmModal",
                    buttons: {
                        success: {
                            label: "确定",
                            className: "btn-primary",
                            callback: function () {
                                if ($("#sjhm").val() == "") {
                                    $.alert("请填写手机号码!");
                                    return false;
                                }

                                if ($("#dlyzm").val() == "") {
                                    $.alert("请填写验证码!");
                                    return false;
                                }

                                $.ajax({
                                    url: _path + '/xtgl/login_dxyzmdlQryzm.html',
                                    async: false,
                                    type: "post",
                                    dataType: "json",
                                    data: {"sjhm": $("#sjhm").val(), "yzm": $("#dlyzm").val()},
                                    success: function (msg) {
                                        if (msg.indexOf("success") != -1) {
                                            $.closeModal("dxyzmModal");
                                            //window.location.href = _path + "/xtgl/index_initMenu.html";
                                            window.location.href = _path + msg.split("-")[1];
                                        } else {
                                            $.alert("验证失败", function () {
                                                //window.location.href = window.location.href;
                                            });
                                        }
                                    }
                                })
                                return false;
                            }
                        },
                        cancel: {
                            label: "关 闭",
                            className: "btn-default",
                            callback: function () {
                                window.location.href = window.location.href;
                            }
                        }
                    }
                }
            ));
            return false;
        });
    });

    /*//pwStrength函数   用于验证
    //当用户放开键盘或密码输入框失去焦点时,根据不同的级别显示提示
    function passStrength(password) {
        var jqYhmmdj=jQuery("#yhmmdj");
        if (password == null || password == '') {
            hideErrMsg();
        } else {
            var S_level = checkStrong(password);
            //设置密码强度
            jqYhmmdj.val(S_level);
            switch (S_level) {
            case 0:
                showErrMsg("密码太短,请及时修改!");
                strong = false;
                return false;
            case 1:
                showErrMsg("密码强度太弱,请及时修改!");
                strong = false;
                return false;
            default:
                strong = true;
                hideErrMsg();
            }
        }

        //验证用户名是否相同
        if(!checkYhmAndMm()){
            //设置密码强度 ,定死设定弱密码
            jqYhmmdj.val("1");
        }
    }*/
    /*	//保存Cookie
        function SetCookie(){
            var username = jQuery("#yhm").val();
            var Then 	 = new Date();
            Then.setTime(Then.getTime() + 1866240000000);
            document.cookie ="yhm="+username+"%%;expires="+ Then.toGMTString() ;
        }*/
    /*	//读取Cookie
        function GetCookie(){
            var nmpsd;
            var nm;
            var cookieString = new String(document.cookie);
            var cookieHeader = "yhm=";
            var beginPosition = cookieString.indexOf(cookieHeader);
            cookieString = cookieString.substring(beginPosition);
            var ends=cookieString.indexOf(";");
            if (ends!=-1){
               cookieString = cookieString.substring(0,ends);
            }
            if (beginPosition>-1){
               nmpsd = cookieString.substring(cookieHeader.length);
               if (nmpsd!=""){
                beginPosition = nmpsd.indexOf("%%");
                nm=nmpsd.substring(0,beginPosition);
                document.getElementById("yhm").value=nm;
               }
            }
        }*/
});
